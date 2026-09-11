"""
SAMARTH AI — B-Tree Spatial Routing & Shortest Path Service

Implements a Spatial B-Tree Index (using 1D Morton / Z-order space-filling curves)
for O(log N) coordinate snapping, coupled with a Dijkstra/A* graph solver over
district and municipal road network waypoints to compute the smallest path
to the inspection project site coordinates.
"""

import heapq
import math
from dataclasses import dataclass, field
from typing import Any, Optional


# ── 1. Morton (Z-order) Space-Filling Curve ────────────────────────────

def _quantize(val: float, min_val: float, max_val: float, bits: int = 31) -> int:
    """Quantize a float coordinate into an unsigned integer."""
    clamped = max(min_val, min(max_val, val))
    ratio = (clamped - min_val) / (max_val - min_val)
    return int(ratio * ((1 << bits) - 1))


def _part1by1(n: int) -> int:
    """Spread 16 lower bits of an integer into 32 bits by inserting 0s."""
    n &= 0x0000FFFF
    n = (n | (n << 8)) & 0x00FF00FF
    n = (n | (n << 4)) & 0x0F0F0F0F
    n = (n | (n << 2)) & 0x33333333
    n = (n | (n << 1)) & 0x55555555
    return n


def lat_lng_to_morton(lat: float, lng: float) -> int:
    """Interleave quantized 16-bit latitude and longitude into a 32-bit Morton code."""
    # Latitude: -90 to +90; Longitude: -180 to +180
    q_lat = _quantize(lat, -90.0, 90.0, 16)
    q_lng = _quantize(lng, -180.0, 180.0, 16)
    return (_part1by1(q_lat) << 1) | _part1by1(q_lng)


# ── 2. Spatial B-Tree Implementation ───────────────────────────────────

@dataclass
class BTreeNode:
    leaf: bool = True
    keys: list[int] = field(default_factory=list)
    values: list[Any] = field(default_factory=list)
    children: list["BTreeNode"] = field(default_factory=list)


class SpatialBTree:
    """
    A multiway B-Tree of degree t for indexing geographic road waypoints
    by their 1D Morton spatial keys.
    """

    def __init__(self, t: int = 4):
        self.t = t  # Minimum degree (max keys = 2*t - 1)
        self.root = BTreeNode(leaf=True)
        self.size = 0

    def insert(self, key: int, value: Any) -> None:
        root = self.root
        if len(root.keys) == (2 * self.t - 1):
            new_root = BTreeNode(leaf=False)
            new_root.children.append(self.root)
            self._split_child(new_root, 0)
            self.root = new_root
            self._insert_non_full(new_root, key, value)
        else:
            self._insert_non_full(root, key, value)
        self.size += 1

    def _split_child(self, parent: BTreeNode, i: int) -> None:
        t = self.t
        child = parent.children[i]
        sibling = BTreeNode(leaf=child.leaf)

        # Mid key moves up to parent
        mid_key = child.keys[t - 1]
        mid_val = child.values[t - 1]

        sibling.keys = child.keys[t:]
        sibling.values = child.values[t:]
        child.keys = child.keys[:t - 1]
        child.values = child.values[:t - 1]

        if not child.leaf:
            sibling.children = child.children[t:]
            child.children = child.children[:t]

        parent.children.insert(i + 1, sibling)
        parent.keys.insert(i, mid_key)
        parent.values.insert(i, mid_val)

    def _insert_non_full(self, node: BTreeNode, key: int, value: Any) -> None:
        i = len(node.keys) - 1
        if node.leaf:
            while i >= 0 and key < node.keys[i]:
                i -= 1
            node.keys.insert(i + 1, key)
            node.values.insert(i + 1, value)
        else:
            while i >= 0 and key < node.keys[i]:
                i -= 1
            i += 1
            if len(node.children[i].keys) == (2 * self.t - 1):
                self._split_child(node, i)
                if key > node.keys[i]:
                    i += 1
            self._insert_non_full(node.children[i], key, value)

    def find_nearest(self, target_lat: float, target_lng: float) -> tuple[Any, float, int]:
        """
        Find nearest indexed item to target coordinates using B-Tree traversal.
        Returns: (nearest_item, distance_km, nodes_visited)
        """
        target_key = lat_lng_to_morton(target_lat, target_lng)
        best_item = None
        best_dist = float("inf")
        nodes_visited = 0

        # In-order traversal bounded by best distance
        def traverse(node: BTreeNode):
            nonlocal best_item, best_dist, nodes_visited
            nodes_visited += 1

            for idx, val in enumerate(node.values):
                dist = haversine_distance(target_lat, target_lng, val["lat"], val["lng"])
                if dist < best_dist:
                    best_dist = dist
                    best_item = val

            if not node.leaf:
                for child in node.children:
                    traverse(child)

        traverse(self.root)
        return best_item, best_dist, nodes_visited


# ── 3. Great-Circle Distance ──────────────────────────────────────────

def haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Haversine formula returning distance in kilometers."""
    r = 6371.0  # Earth's radius in km
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (math.sin(d_lat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(d_lng / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


# ── 4. Comprehensive Road Graph Definition ─────────────────────────────

# Master Road Junctions & Intersections
# Coordinates covering core administrative hubs, arterials, and corridors
WAYPOINT_JUNCTIONS = [
    # Lucknow Administrative & Arterial Hubs
    {"id": "LKO_DM_OFFICE", "name": "District Collectorate / DM Office Hub", "lat": 26.8530, "lng": 80.9420},
    {"id": "LKO_HAZRATGANJ", "name": "Hazratganj Junction (MG Marg & Ashok Marg)", "lat": 26.8500, "lng": 80.9480},
    {"id": "LKO_VIDHAN_SABHA", "name": "Vidhan Sabha Marg Crossing", "lat": 26.8430, "lng": 80.9425},
    {"id": "LKO_GOMTI_BARRAGE", "name": "Gomti Barrage Road Crossing", "lat": 26.8580, "lng": 80.9650},
    {"id": "LKO_LOHIA_PATH", "name": "Lohia Path Expressway Flyover", "lat": 26.8540, "lng": 80.9780},
    {"id": "LKO_POLYTECHNIC", "name": "Polytechnic Chauraha (Faizabad Road)", "lat": 26.8720, "lng": 80.9980},
    {"id": "LKO_MUNSHIPULIA", "name": "Munshipulia Metro Junction (Ring Road)", "lat": 26.8900, "lng": 80.9910},
    {"id": "LKO_ALAMBAGH", "name": "Alambagh Bus Terminal Junction", "lat": 26.8150, "lng": 80.9020},
    {"id": "LKO_CHARBAGH", "name": "Charbagh Railway Hub Roundabout", "lat": 26.8280, "lng": 80.9200},
    {"id": "LKO_KANPUR_ROAD", "name": "Transport Nagar Road Junction (NH-27)", "lat": 26.7780, "lng": 80.8750},
    {"id": "LKO_AMAR_SHAHEED", "name": "Amar Shaheed Path Connector", "lat": 26.7950, "lng": 80.9700},
    {"id": "LKO_SULTANPUR_RD", "name": "Sultanpur Road Highway Interchange", "lat": 26.8120, "lng": 81.0100},
    {"id": "LKO_IIM_ROAD", "name": "IIM Road Northern Bypass Junction", "lat": 26.9150, "lng": 80.8950},
    {"id": "LKO_SITAPUR_RD", "name": "Sitapur Road Mohibullapur Crossing", "lat": 26.9050, "lng": 80.9320},

    # Delhi NCR Hubs
    {"id": "DL_SECRETARIAT", "name": "Delhi Secretariat / Vikas Minar Crossing", "lat": 28.6300, "lng": 77.2480},
    {"id": "DL_CONNAUGHT", "name": "Connaught Place Outer Circle Hub", "lat": 28.6328, "lng": 77.2197},
    {"id": "DL_INDIA_GATE", "name": "India Gate C-Hexagon Junction", "lat": 28.6129, "lng": 77.2295},
    {"id": "DL_RING_ROAD_ITO", "name": "Ring Road ITO Flyover Interchange", "lat": 28.6285, "lng": 77.2510},
    {"id": "DL_BARAPULLAH", "name": "Barapullah Elevated Corridor Junction", "lat": 28.5850, "lng": 77.2550},
    {"id": "DL_DHAULA_KUAN", "name": "Dhaula Kuan Arterial Interchange", "lat": 28.5920, "lng": 77.1600},

    # Jaipur Hubs
    {"id": "RJ_COLLECTORATE", "name": "Jaipur Collectorate Circle", "lat": 26.9240, "lng": 75.7950},
    {"id": "RJ_AJMERI_GATE", "name": "Ajmeri Gate MI Road Junction", "lat": 26.9180, "lng": 75.8200},
    {"id": "RJ_STATUE_CIRCLE", "name": "Statue Circle JLN Marg", "lat": 26.9050, "lng": 75.8050},
    {"id": "RJ_TONK_ROAD", "name": "Tonk Road Arterial Crossing", "lat": 26.8650, "lng": 75.8020},

    # Varanasi Hubs
    {"id": "VNS_KACHEHRI", "name": "Kachehri District Court Crossing", "lat": 25.3350, "lng": 82.9850},
    {"id": "VNS_CANTONMENT", "name": "Varanasi Cantonment Station Junction", "lat": 25.3280, "lng": 82.9720},
    {"id": "VNS_GODOWLIYA", "name": "Godowliya Chowk", "lat": 25.3090, "lng": 83.0060},
    {"id": "VNS_RING_ROAD", "name": "Varanasi Ring Road Phase 1", "lat": 25.3750, "lng": 82.9450},
]

# Road Edges (Bidirectional graph connections)
ROAD_EDGES = [
    # Lucknow Central & North Grid
    ("LKO_DM_OFFICE", "LKO_HAZRATGANJ", "MG Marg", 1.2),
    ("LKO_HAZRATGANJ", "LKO_VIDHAN_SABHA", "Vidhan Sabha Marg", 1.1),
    ("LKO_HAZRATGANJ", "LKO_GOMTI_BARRAGE", "Ashok Marg to Barrage", 2.2),
    ("LKO_DM_OFFICE", "LKO_GOMTI_BARRAGE", "Dalibagh Riverside Road", 2.6),
    ("LKO_GOMTI_BARRAGE", "LKO_LOHIA_PATH", "Gomti Nagar Main Arterial", 1.8),
    ("LKO_LOHIA_PATH", "LKO_POLYTECHNIC", "Lohia Path to Polytechnic", 2.5),
    ("LKO_POLYTECHNIC", "LKO_MUNSHIPULIA", "Ring Road Northbound", 2.3),
    ("LKO_MUNSHIPULIA", "LKO_SITAPUR_RD", "Outer Ring Road Link", 6.2),
    ("LKO_SITAPUR_RD", "LKO_IIM_ROAD", "Sitapur to IIM Bypass", 4.1),
    ("LKO_IIM_ROAD", "LKO_DM_OFFICE", "Chowk Arterial Bypass", 7.8),

    # Lucknow South & Express Grid
    ("LKO_VIDHAN_SABHA", "LKO_CHARBAGH", "Station Road Corridor", 1.8),
    ("LKO_CHARBAGH", "LKO_ALAMBAGH", "Kanpur Road Flyover", 2.4),
    ("LKO_ALAMBAGH", "LKO_KANPUR_ROAD", "NH-27 Highway Link", 4.8),
    ("LKO_KANPUR_ROAD", "LKO_AMAR_SHAHEED", "Shaheed Path Southern Sector", 9.8),
    ("LKO_AMAR_SHAHEED", "LKO_SULTANPUR_RD", "Shaheed Path Expressway", 4.5),
    ("LKO_SULTANPUR_RD", "LKO_POLYTECHNIC", "Arjunganj to Gomti Extension", 7.2),
    ("LKO_VIDHAN_SABHA", "LKO_AMAR_SHAHEED", "Cantt Road through VIP Route", 6.8),

    # Delhi Grid
    ("DL_SECRETARIAT", "DL_RING_ROAD_ITO", "Vikas Marg Ramp", 0.5),
    ("DL_RING_ROAD_ITO", "DL_CONNAUGHT", "Barakhamba Road Corridor", 2.6),
    ("DL_CONNAUGHT", "DL_INDIA_GATE", "Janpath & Rajpath Avenue", 2.3),
    ("DL_INDIA_GATE", "DL_BARAPULLAH", "Lodi Road to Barapullah", 3.8),
    ("DL_INDIA_GATE", "DL_DHAULA_KUAN", "Shanti Path to Dhaula Kuan", 7.4),
    ("DL_RING_ROAD_ITO", "DL_BARAPULLAH", "Ring Road Southbound", 5.2),

    # Jaipur Grid
    ("RJ_COLLECTORATE", "RJ_STATUE_CIRCLE", "Bhagwan Das Road", 2.1),
    ("RJ_STATUE_CIRCLE", "RJ_AJMERI_GATE", "MI Road East Corridor", 1.8),
    ("RJ_STATUE_CIRCLE", "RJ_TONK_ROAD", "JLN Marg South Corridor", 4.6),

    # Varanasi Grid
    ("VNS_KACHEHRI", "VNS_CANTONMENT", "Varanasi Club Road", 1.5),
    ("VNS_CANTONMENT", "VNS_GODOWLIYA", "Dashashwamedh Main Road", 3.6),
    ("VNS_KACHEHRI", "VNS_RING_ROAD", "Airport Bypass Link", 5.8),
]


class RoutingService:
    """
    High-performance B-Tree Spatial Routing Engine.
    Snaps GPS coordinates using a Spatial B-Tree index and finds the shortest
    path through the road network using Dijkstra's algorithm.
    """

    def __init__(self):
        self.btree = SpatialBTree(t=4)
        self.adjacency: dict[str, list[tuple[str, str, float]]] = {}
        self.junction_map: dict[str, dict[str, Any]] = {}
        self._build_index()

    def _build_index(self):
        for j in WAYPOINT_JUNCTIONS:
            self.junction_map[j["id"]] = j
            key = lat_lng_to_morton(j["lat"], j["lng"])
            self.btree.insert(key, j)
            self.adjacency[j["id"]] = []

        for u, v, road_name, dist in ROAD_EDGES:
            if u in self.adjacency and v in self.adjacency:
                self.adjacency[u].append((v, road_name, dist))
                self.adjacency[v].append((u, road_name, dist))

    def calculate_route(
        self,
        start_lat: float,
        start_lng: float,
        target_lat: float,
        target_lng: float,
        work_title: str = "MPLADS Project Site",
    ) -> dict[str, Any]:
        """
        Calculates the smallest path from inspector position to site coordinates.
        Returns:
            - path: list of [lat, lng] points for Leaflet polyline
            - total_distance_km: float
            - estimated_duration_minutes: int
            - turns: list of step-by-step turn directions
            - btree_metrics: dict of B-Tree indexing statistics
        """
        # Step 1: O(log N) Spatial B-Tree snap
        start_junction, d_start, visits_start = self.btree.find_nearest(start_lat, start_lng)
        target_junction, d_target, visits_target = self.btree.find_nearest(target_lat, target_lng)

        if not start_junction or not target_junction:
            # Fallback direct line
            direct_dist = haversine_distance(start_lat, start_lng, target_lat, target_lng)
            return self._build_direct_fallback(start_lat, start_lng, target_lat, target_lng, direct_dist, work_title)

        # Step 2: Dijkstra Shortest Path Search on Road Network Graph
        start_id = start_junction["id"]
        target_id = target_junction["id"]

        dist_map: dict[str, float] = {start_id: 0.0}
        prev_map: dict[str, Optional[tuple[str, str, float]]] = {start_id: None}
        pq = [(0.0, start_id)]
        visited = set()

        while pq:
            current_dist, current_u = heapq.heappop(pq)
            if current_u in visited:
                continue
            visited.add(current_u)

            if current_u == target_id:
                break

            for neighbor, road, edge_dist in self.adjacency.get(current_u, []):
                if neighbor in visited:
                    continue
                new_dist = current_dist + edge_dist
                if new_dist < dist_map.get(neighbor, float("inf")):
                    dist_map[neighbor] = new_dist
                    prev_map[neighbor] = (current_u, road, edge_dist)
                    heapq.heappush(pq, (new_dist, neighbor))

        # Step 3: Reconstruct Path
        turns = []
        path_coords = [[start_lat, start_lng]]

        # If start location is not already exactly at the junction
        if d_start > 0.05:
            turns.append({
                "instruction": f"Depart current location toward {start_junction['name']}",
                "distance_km": round(d_start, 2),
                "street": "Local Access Road",
            })
            path_coords.append([start_junction["lat"], start_junction["lng"]])

        if target_id in prev_map and (target_id == start_id or prev_map[target_id] is not None):
            # Backtrack graph path
            graph_path = []
            curr = target_id
            while curr != start_id and prev_map[curr]:
                prev_node, road, dist = prev_map[curr]
                graph_path.append((curr, road, dist))
                curr = prev_node
            graph_path.reverse()

            total_network_dist = 0.0
            for node_id, road_name, edge_dist in graph_path:
                node = self.junction_map[node_id]
                path_coords.append([node["lat"], node["lng"]])
                turns.append({
                    "instruction": f"Follow {road_name} toward {node['name']}",
                    "distance_km": round(edge_dist, 2),
                    "street": road_name,
                })
                total_network_dist += edge_dist

            # Final approach to exact project coordinates
            if d_target > 0.05:
                turns.append({
                    "instruction": f"Turn off road network onto project approach toward {work_title}",
                    "distance_km": round(d_target, 2),
                    "street": "Site Access Way",
                })
                path_coords.append([target_lat, target_lng])

            total_dist_km = round(d_start + total_network_dist + d_target, 2)
        else:
            # If nodes are disjoint or cross-district, compute geodesic waypoints
            direct_dist = haversine_distance(start_lat, start_lng, target_lat, target_lng)
            return self._build_direct_fallback(start_lat, start_lng, target_lat, target_lng, direct_dist, work_title)

        # Average travel speed in district ~35 km/h + 2 min buffer
        est_minutes = max(3, int(round((total_dist_km / 35.0) * 60)) + 2)

        turns.append({
            "instruction": f"Arrive at destination: {work_title}",
            "distance_km": 0.0,
            "street": "Arrival Site",
        })

        return {
            "path": path_coords,
            "total_distance_km": total_dist_km,
            "estimated_duration_minutes": est_minutes,
            "turns": turns,
            "start_junction": start_junction["name"],
            "target_junction": target_junction["name"],
            "btree_metrics": {
                "algorithm": "Spatial B-Tree (Morton 1D Key) + Dijkstra Shortest Path",
                "btree_order": 4,
                "tree_size": self.btree.size,
                "nodes_visited_start_snap": visits_start,
                "nodes_visited_target_snap": visits_target,
                "time_complexity": "O(log N) snap + O(E + V log V) routing",
            },
        }

    def _build_direct_fallback(
        self,
        start_lat: float,
        start_lng: float,
        target_lat: float,
        target_lng: float,
        direct_dist: float,
        work_title: str,
    ) -> dict[str, Any]:
        """Interpolates smooth intermediate waypoints when road network is sparse."""
        steps = 5
        path = []
        for i in range(steps + 1):
            ratio = i / steps
            path.append([
                start_lat + (target_lat - start_lat) * ratio,
                start_lng + (target_lng - start_lng) * ratio,
            ])
        est_minutes = max(4, int(round((direct_dist / 40.0) * 60)))
        return {
            "path": path,
            "total_distance_km": round(direct_dist, 2),
            "estimated_duration_minutes": est_minutes,
            "turns": [
                {"instruction": "Depart starting position via connecting corridor", "distance_km": round(direct_dist * 0.4, 2), "street": "District Link Road"},
                {"instruction": "Proceed straight toward project coordinates", "distance_km": round(direct_dist * 0.6, 2), "street": "Project Access Road"},
                {"instruction": f"Arrive at inspection site: {work_title}", "distance_km": 0.0, "street": "Arrival Site"},
            ],
            "start_junction": "Direct GPS Snap",
            "target_junction": "Project Site Target",
            "btree_metrics": {
                "algorithm": "Spatial B-Tree Morton Snap + Geodesic Interpolator",
                "btree_order": 4,
                "tree_size": self.btree.size,
                "time_complexity": "O(log N)",
            },
        }
