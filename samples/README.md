# Sample location CSV

`sample-locations.csv` shows the format Atlas Watch imports. These are example
coordinates for well-known city centers, not real properties.

| Column       | Required | Notes                                                    |
|--------------|----------|----------------------------------------------------------|
| `name`       | yes      | Up to 120 characters.                                    |
| `latitude`   | yes      | Decimal degrees, -90 to 90 (WGS84).                      |
| `longitude`  | yes      | Decimal degrees, -180 to 180. U.S. longitudes are negative. |
| `category`   | no       | Free text, e.g. Office, Warehouse, Rental.               |
| `notes`      | no       | Up to 2000 characters.                                   |
| `radius_km`  | no       | Earthquake monitoring radius, 0–2000 km. Defaults to 50. |

Column names are matched automatically (for example `lat`, `lng`, `long`, `radius`),
and you can remap any column during import. Before anything is saved, the import
preview flags invalid rows and duplicates.

A row is a **duplicate** when its name matches an existing location (ignoring case)
and its coordinates are within 25 m. For duplicates of existing locations, you
can **skip** them, **update** the existing location, or **keep both**. Duplicate
rows within the same file are skipped unless you choose "keep both".
