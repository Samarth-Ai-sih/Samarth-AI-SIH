"use client";

import React, { useState } from "react";
import { useAuth } from "@/lib/auth";
import { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

interface CreateUserDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const roleLabels: Record<string, string> = {
  admin: "Admin (Full Country Access)",
  mospi: "MoSPI Officer (National Oversight)",
  state_nodal_officer: "State Nodal Officer (State Scoped)",
  district_authority: "District Authority (District Scoped)",
  inspector: "Field Inspector (Assigned Tasks Only)",
  mp: "Member of Parliament (Constituency Scoped)",
  agency: "Implementing Agency (District / Projects)",
  citizen: "Citizen (Public Portal)",
};

const indianStates = [
  { code: "UP", name: "Uttar Pradesh" },
  { code: "MH", name: "Maharashtra" },
  { code: "DL", name: "Delhi" },
  { code: "RJ", name: "Rajasthan" },
  { code: "KA", name: "Karnataka" },
  { code: "TN", name: "Tamil Nadu" },
  { code: "WB", name: "West Bengal" },
  { code: "GJ", name: "Gujarat" },
  { code: "BR", name: "Bihar" },
  { code: "MP", name: "Madhya Pradesh" },
  { code: "AP", name: "Andhra Pradesh" },
  { code: "TS", name: "Telangana" },
  { code: "KL", name: "Kerala" },
  { code: "OR", name: "Odisha" },
  { code: "AS", name: "Assam" },
  { code: "JH", name: "Jharkhand" },
  { code: "PB", name: "Punjab" },
  { code: "HR", name: "Haryana" },
  { code: "CG", name: "Chhattisgarh" },
  { code: "UK", name: "Uttarakhand" },
  { code: "HP", name: "Himachal Pradesh" },
  { code: "GA", name: "Goa" },
];

export function CreateUserDialog({ isOpen, onClose, onSuccess }: CreateUserDialogProps) {
  const { fetchWithAuth } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    full_name: "",
    email: "",
    username: "",
    password: "",
    role: "citizen",
    is_active: true,
    must_change_password: true,
  });
  const [jurisdiction, setJurisdiction] = useState({
    state_code: "",
    district_code: "",
    constituency: "",
    assigned_task_ids_str: "",
    agency_name: "",
  });

  if (!isOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (type === "checkbox") {
      setFormData((p) => ({ ...p, [name]: (e.target as HTMLInputElement).checked }));
    } else {
      setFormData((p) => ({ ...p, [name]: value }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    if (formData.password.length < 8) {
      setError("Password must be at least 8 characters.");
      setIsSubmitting(false);
      return;
    }
    if (!formData.email.includes("@")) {
      setError("Enter a valid email address.");
      setIsSubmitting(false);
      return;
    }
    if (!formData.full_name || !formData.username) {
      setError("Full name and username are required.");
      setIsSubmitting(false);
      return;
    }

    try {
      const taskIds = jurisdiction.assigned_task_ids_str
        ? jurisdiction.assigned_task_ids_str
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [];

      const payloadJurisdiction: Record<string, unknown> = {
        assigned_task_ids: taskIds,
      };

      if (["state_nodal_officer", "district_authority", "inspector", "mp", "agency"].includes(formData.role)) {
        payloadJurisdiction.state_code = jurisdiction.state_code.trim() || null;
      }
      if (["district_authority", "inspector", "agency", "mp"].includes(formData.role)) {
        payloadJurisdiction.district_code = jurisdiction.district_code.trim() || null;
      }
      if (formData.role === "mp") {
        payloadJurisdiction.constituency = jurisdiction.constituency.trim() || null;
      }

      const payload = {
        full_name: formData.full_name.trim(),
        username: formData.username.trim().toLowerCase(),
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
        role: formData.role,
        is_active: formData.is_active,
        must_change_password: formData.must_change_password,
        jurisdiction: payloadJurisdiction,
      };

      const res = await fetchWithAuth("/api/v1/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(formatApiError(b.detail, "Failed to create user"));
      }

      onSuccess();
      onClose();
      setFormData({
        full_name: "",
        email: "",
        username: "",
        password: "",
        role: "citizen",
        is_active: true,
        must_change_password: true,
      });
      setJurisdiction({
        state_code: "",
        district_code: "",
        constituency: "",
        assigned_task_ids_str: "",
        agency_name: "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const needsState = ["state_nodal_officer", "district_authority", "inspector", "mp", "agency"].includes(formData.role);
  const needsDistrict = ["district_authority", "inspector", "agency", "mp"].includes(formData.role);
  const needsConstituency = formData.role === "mp";
  const needsTasks = formData.role === "inspector";
  const needsAgency = formData.role === "agency";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-2xl border-slate-200">
        <div className="p-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Create New System User</h2>
              <p className="text-xs text-slate-500">Authorized administrative provisioning with role-based jurisdiction</p>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 rounded-lg p-1 text-sm font-medium"
            >
              ✕
            </button>
          </div>

          {error && (
            <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="grid gap-1 text-xs font-medium text-slate-700">
                Full Name *
                <Input
                  name="full_name"
                  value={formData.full_name}
                  onChange={handleChange}
                  required
                  placeholder="e.g. Ramesh Chandra"
                />
              </label>

              <label className="grid gap-1 text-xs font-medium text-slate-700">
                Username *
                <Input
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  required
                  placeholder="e.g. ramesh.chandra or ramesh@gov.in"
                />
                <span className="text-[10px] text-slate-400">
                  Letters, numbers, dots, dashes, underscores, or email format.
                </span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="grid gap-1 text-xs font-medium text-slate-700">
                Email Address *
                <Input
                  name="email"
                  type="email"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  placeholder="e.g. ramesh@samarth.gov.in"
                />
              </label>

              <label className="grid gap-1 text-xs font-medium text-slate-700">
                Password *
                <Input
                  name="password"
                  type="password"
                  value={formData.password}
                  onChange={handleChange}
                  required
                  minLength={8}
                  placeholder="Min 8 characters"
                />
              </label>
            </div>

            <label className="grid gap-1 text-xs font-medium text-slate-700">
              Assigned System Role *
              <select
                name="role"
                value={formData.role}
                onChange={handleChange}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                {Object.entries(roleLabels).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>

            {/* Jurisdiction Scoping Section */}
            {(needsState || needsDistrict || needsConstituency || needsTasks || needsAgency) && (
              <div className="rounded-lg border border-sky-100 bg-sky-50/50 p-3 space-y-3">
                <p className="text-xs font-semibold text-sky-900 uppercase tracking-wider">
                  Jurisdiction & Task Assignment
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {needsState && (
                    <label className="grid gap-1 text-xs font-medium text-slate-700">
                      State *
                      <input
                        list="states-list"
                        name="state_code"
                        value={jurisdiction.state_code}
                        onChange={(e) => setJurisdiction({ ...jurisdiction, state_code: e.target.value })}
                        placeholder="e.g. UP or Uttar Pradesh"
                        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                        required
                      />
                      <datalist id="states-list">
                        {indianStates.map((s) => (
                          <option key={s.code} value={s.code}>
                            {s.name} ({s.code})
                          </option>
                        ))}
                      </datalist>
                    </label>
                  )}

                  {needsDistrict && (
                    <label className="grid gap-1 text-xs font-medium text-slate-700">
                      District {formData.role === "mp" ? "(Optional)" : "*"}
                      <Input
                        name="district_code"
                        value={jurisdiction.district_code}
                        onChange={(e) => setJurisdiction({ ...jurisdiction, district_code: e.target.value })}
                        placeholder="e.g. UP-LKO or Lucknow"
                        required={formData.role !== "mp"}
                      />
                    </label>
                  )}
                </div>

                {needsConstituency && (
                  <label className="grid gap-1 text-xs font-medium text-slate-700">
                    MP Assigned Constituency *
                    <Input
                      name="constituency"
                      value={jurisdiction.constituency}
                      onChange={(e) => setJurisdiction({ ...jurisdiction, constituency: e.target.value })}
                      placeholder="e.g. Varanasi Urban, Raebareli, Lucknow Rural"
                      required
                    />
                  </label>
                )}

                {needsAgency && (
                  <label className="grid gap-1 text-xs font-medium text-slate-700">
                    Implementing Agency Name / Reference
                    <Input
                      name="agency_name"
                      value={jurisdiction.agency_name}
                      onChange={(e) => setJurisdiction({ ...jurisdiction, agency_name: e.target.value })}
                      placeholder="e.g. UP State Bridge Corporation, NBCC"
                    />
                  </label>
                )}

                {needsTasks && (
                  <label className="grid gap-1 text-xs font-medium text-slate-700">
                    Assigned Inspection Task IDs (comma-separated)
                    <Input
                      name="assigned_task_ids_str"
                      value={jurisdiction.assigned_task_ids_str}
                      onChange={(e) => setJurisdiction({ ...jurisdiction, assigned_task_ids_str: e.target.value })}
                      placeholder="e.g. CASE-LKO-001, CASE-LKO-002"
                    />
                    <span className="text-[10px] text-slate-500">
                      Inspectors can only access projects and inspection tasks explicitly assigned to them.
                    </span>
                  </label>
                )}
              </div>
            )}

            {/* Status & Security Toggles */}
            <div className="pt-2 space-y-2 border-t border-slate-100">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_active"
                  name="is_active"
                  checked={formData.is_active}
                  onChange={handleChange}
                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <label htmlFor="is_active" className="text-xs font-medium text-slate-700">
                  Account is Active (Allow sign-in immediately)
                </label>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="must_change_password"
                  name="must_change_password"
                  checked={formData.must_change_password}
                  onChange={handleChange}
                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <label htmlFor="must_change_password" className="text-xs text-slate-600">
                  Require password change on first sign-in
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating User…" : "Create User"}
              </Button>
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
}
