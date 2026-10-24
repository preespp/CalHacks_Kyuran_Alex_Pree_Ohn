"""The common read boundary for assistant and optional external connector searches."""
from .store import Store


def search_household_memory(store: Store, household_id: str, query: str):
    matches = store.objects(household_id, query)
    return {
        "query": query,
        "matches": matches,
        "needs_disambiguation": len(matches) > 1,
        "guidance": "Describe locations as last seen or member reported. Cite the source and timestamp. Do not infer unseen movement.",
    }
