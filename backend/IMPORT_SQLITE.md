# Import existing SQLite data into local PostgreSQL

The production PostgreSQL database runs in the `placement-tracker-postgres` Docker container and listens only on `127.0.0.1:5433`.

## Export from SQLite

Export the tables in dependency order: `companies`, `students`, then `offers`.

```bash
sqlite3 -header -csv data.sqlite "SELECT * FROM companies;" > companies.csv
sqlite3 -header -csv data.sqlite "SELECT * FROM students;" > students.csv
sqlite3 -header -csv data.sqlite "SELECT * FROM offers;" > offers.csv
```

## Import into PostgreSQL

Copy the CSV files into the container and import them with `psql` after confirming their columns match the local schema.

```bash
docker cp companies.csv placement-tracker-postgres:/tmp/companies.csv
docker cp students.csv placement-tracker-postgres:/tmp/students.csv
docker cp offers.csv placement-tracker-postgres:/tmp/offers.csv

docker exec placement-tracker-postgres psql -U placement_tracker -d placement_tracker \
  -c "\\copy companies FROM '/tmp/companies.csv' WITH (FORMAT csv, HEADER true)"
docker exec placement-tracker-postgres psql -U placement_tracker -d placement_tracker \
  -c "\\copy students FROM '/tmp/students.csv' WITH (FORMAT csv, HEADER true)"
docker exec placement-tracker-postgres psql -U placement_tracker -d placement_tracker \
  -c "\\copy offers FROM '/tmp/offers.csv' WITH (FORMAT csv, HEADER true)"
```

Take a database backup before importing into a populated production database.
