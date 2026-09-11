"""Safety checks for the controlled synthetic work seeder."""

import pytest

from scripts import seed_works
from scripts.generate_training_dataset import insert_to_mongodb


def test_generated_work_is_explicitly_marked_as_synthetic_demo():
    works = seed_works.generate_works()

    assert works
    assert {work["data_source"] for work in works} == {"synthetic_demo"}


@pytest.mark.asyncio
async def test_seed_work_script_does_not_modify_a_nonempty_collection(monkeypatch):
    class Collection:
        async def count_documents(self, query):
            return 1

        async def insert_many(self, documents):  # pragma: no cover - must not run
            raise AssertionError("nonempty collection must not be seeded")

    class Database:
        disconnected = False

        def __init__(self, settings):
            self.collection = Collection()

        async def connect(self):
            return None

        def get_collection(self, name):
            assert name == "works"
            return self.collection

        async def disconnect(self):
            self.disconnected = True

    database = Database(None)
    monkeypatch.setattr(seed_works, "Database", lambda settings: database)
    monkeypatch.setattr(seed_works, "get_settings", lambda: object())

    await seed_works.main()

    assert database.disconnected is True


@pytest.mark.asyncio
async def test_training_dataset_insert_is_non_destructive_when_a_target_exists():
    class Collection:
        async def count_documents(self, query):
            return 1

        async def insert_many(self, documents):  # pragma: no cover - must not run
            raise AssertionError("existing collections must not be modified")

    class Database:
        def get_collection(self, name):
            return Collection()

    await insert_to_mongodb({"works": [{"work_id": "synthetic"}]}, Database())
