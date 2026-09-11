# UK location selector

The City selector uses the GeoNames GB extract, downloaded 2026-09-11:
- https://download.geonames.org/export/dump/GB.zip
- https://download.geonames.org/export/dump/admin2Codes.txt
- Schema: https://download.geonames.org/export/dump/readme.txt
- License: https://creativecommons.org/licenses/by/4.0/ (visible attribution in selector)

Rebuild: download the two sources to a temporary directory, naming the second `admin2.txt`, then run `python3 scripts/build-uk-places.py <directory>`.

Includes populated-place records, excluding abandoned, destroyed and historical places. Cities, towns, villages and suburbs are included; this is not a list limited to places with royal city status. County / area follows GeoNames administrative level 2, including counties, council areas, boroughs and unitary authorities, grouped by UK constituent country. It is not a ceremonial or historic county taxonomy. Unassigned records are preserved separately, rather than assigned a fictional county. Source completeness/currentness is not guaranteed by GeoNames.

The JSON is fetched only when City is expanded and served from the website itself; no API key, paid service or location upload is needed. City selections use stable GeoNames IDs, county selections use GeoNames administrative codes. Nearby and City selections are mutually exclusive. Existing illustrative sessions all use their existing Crystal Palace venue, tagged Greater London, London and Crystal Palace. Future session data must carry correct `areaId` and `cityIds`; never match ambiguous place names or fall back to the user's position.
