import unittest
from services.worker.relations import h_zone, v_zone, gap, relation, build_relations
from services.worker.matching import cosine, create_object, find_match
from services.worker.vision import Detection


class TestWorkerModules(unittest.TestCase):
    def test_zones(self):
        self.assertEqual(h_zone([0.1, 0.1, 0.2, 0.2]), "left")
        self.assertEqual(h_zone([0.4, 0.1, 0.5, 0.2]), "center")
        self.assertEqual(h_zone([0.7, 0.1, 0.9, 0.2]), "right")

        self.assertEqual(v_zone([0.1, 0.1, 0.2, 0.2]), "top")
        self.assertEqual(v_zone([0.1, 0.4, 0.2, 0.5]), "middle")
        self.assertEqual(v_zone([0.1, 0.7, 0.2, 0.9]), "bottom")

    def test_geometric_relations(self):
        # Two boxes side-by-side
        a = [0.1, 0.5, 0.3, 0.7]
        b = [0.32, 0.5, 0.52, 0.7]
        rel = relation(a, b, depth_a=0.5, depth_b=0.5)
        self.assertEqual(rel, "left_of")

        # Two overlapping boxes with depth difference
        rel_front = relation(a, a, depth_a=0.8, depth_b=0.3)
        self.assertEqual(rel_front, "in_front_of")

    def test_cosine_and_matching(self):
        v1 = [1.0, 0.0, 0.0]
        v2 = [1.0, 0.0, 0.0]
        v3 = [0.0, 1.0, 0.0]
        self.assertAlmostEqual(cosine(v1, v2), 1.0)
        self.assertAlmostEqual(cosine(v1, v3), 0.0)

        obj = create_object(label="coffee", appearance="can", embedding=v1)
        # Should match identical label and embedding
        matched = find_match(v1, "coffee", [obj], threshold=0.7)
        self.assertIsNotNone(matched)
        self.assertEqual(matched.object_id, obj.object_id)

        # Should reject different label
        unmatched = find_match(v1, "laptop", [obj], threshold=0.7)
        self.assertIsNone(unmatched)


if __name__ == "__main__":
    unittest.main()
