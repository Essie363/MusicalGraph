import unittest

from sync_supabase_daily import conflict_row, plan_schedules, schedule_key


class DailySyncPlanningTests(unittest.TestCase):
    def test_normalizes_empty_schedule_fields(self):
        self.assertEqual(
            schedule_key({"date": "2020-01-01", "time": None, "city": " 上海 "}),
            ("2020-01-01", "", "上海", "", ""))

    def test_exact_schedule_reuses_online_id(self):
        local = [{"id": 8, "date": "2020-01-01", "time": "19:30", "city": "上海",
                  "musical": "A", "theatre": "B"}]
        remote = [{**local[0], "id": 99}]
        mapping, inserts, conflicts = plan_schedules(local, remote)
        self.assertEqual(mapping, {8: 99})
        self.assertEqual(inserts, [])
        self.assertEqual(conflicts, [])

    def test_new_schedule_is_inserted_without_local_database_id(self):
        local = [{"id": 8, "date": "2020-01-01", "time": "19:30", "city": "上海",
                  "musical": "A", "theatre": "B"}]
        mapping, inserts, conflicts = plan_schedules(local, [])
        self.assertEqual(mapping, {})
        self.assertEqual(inserts[0]["_local_id"], 8)
        self.assertEqual(conflicts, [])

    def test_near_duplicate_theatre_is_flagged_and_not_inserted(self):
        local = [{"id": 8, "date": "2020-01-01", "time": "19:30", "city": "上海",
                  "musical": "A", "theatre": "剧院二"}]
        remote = [{"id": 99, "date": "2020-01-01", "time": "19:30", "city": "上海",
                   "musical": "A", "theatre": "剧院一"}]
        mapping, inserts, conflicts = plan_schedules(local, remote)
        self.assertEqual(mapping, {})
        self.assertEqual(inserts, [])
        self.assertEqual(conflicts[0]["field_name"], "theatre")

    def test_conflict_fingerprint_is_stable(self):
        first = conflict_row("artist", {"id": 1}, "name", "甲", "乙")
        second = conflict_row("artist", {"id": 1}, "name", "甲", "乙")
        self.assertEqual(first["fingerprint"], second["fingerprint"])


if __name__ == "__main__":
    unittest.main()
