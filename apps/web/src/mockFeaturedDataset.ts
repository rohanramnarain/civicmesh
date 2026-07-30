import type { FeaturedDataset } from "./api";

/**
 * Development-only mock featured dataset.
 * Used when both Firestore and the API backend are unavailable so the
 * forecast flow can still be exercised locally.
 */
export const MOCK_FEATURED_DATASET: FeaturedDataset = {
  dataset_id: "nyc-311-zip-complaints-mock",
  title: "NYC 311 Complaints by ZIP (2020-2025) — Mock",
  description:
    "Pre-loaded sample of NYC 311 heat/hot-water and street-condition complaints grouped by ZIP code and year. Safe for offline demos.",
  agency_name: "NYC 311",
  category: "Social Services",
  source_url: "https://data.cityofnewyork.us/Social-Services/311-Service-Requests",
  years: [2020, 2021, 2022, 2023, 2024, 2025],
  metrics: ["complaint_count"],
  rows: [
    {
      zipcode: "10027",
      complaint_type: "heat/hot water",
      year: 2020,
      complaint_count: 119,
    },
    {
      zipcode: "10027",
      complaint_type: "heat/hot water",
      year: 2021,
      complaint_count: 125,
    },
    {
      zipcode: "10027",
      complaint_type: "heat/hot water",
      year: 2022,
      complaint_count: 119,
    },
    {
      zipcode: "10027",
      complaint_type: "heat/hot water",
      year: 2023,
      complaint_count: 134,
    },
    {
      zipcode: "10027",
      complaint_type: "heat/hot water",
      year: 2024,
      complaint_count: 134,
    },
    {
      zipcode: "10027",
      complaint_type: "heat/hot water",
      year: 2025,
      complaint_count: 142,
    },
    {
      zipcode: "10025",
      complaint_type: "street condition",
      year: 2025,
      complaint_count: 89,
    },
  ],
};
