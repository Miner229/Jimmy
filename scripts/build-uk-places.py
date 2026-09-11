"""Build with: python3 scripts/build-uk-places.py /path/to/geonames-downloads
Inputs: GB.zip, admin2.txt (admin2Codes.txt). See docs/UK_PLACES.md.
"""
import sys, json, zipfile, pathlib, datetime, collections
source = pathlib.Path(sys.argv[1])
countries = {'ENG':'England','SCT':'Scotland','WLS':'Wales','NIR':'Northern Ireland'}
areas = {}
for line in (source/'admin2.txt').read_text().splitlines():
    code, name, *_ = line.split('\t')
    parts = code.split('.')
    if len(parts)==3 and parts[0]=='GB' and parts[1] in countries:
        areas[code] = {'id':code,'name':name,'country':countries[parts[1]],'places':[]}
for line in zipfile.ZipFile(source/'GB.zip').read('GB.txt').decode().splitlines():
    r = line.split('\t')
    if r[6]!='P' or r[7] in ('PPLH','PPLQ','PPLW'): continue
    code = '.'.join(['GB',r[10],r[11]])
    if code not in areas:
        # Preserve unassigned records without inventing a county.
        areas[code] = {'id':code,'name':'Other / unassigned areas','country':countries.get(r[10],'United Kingdom'),'places':[]}
    areas[code]['places'].append({'id':r[0],'name':r[1]})
for area in areas.values(): area['places'].sort(key=lambda p:(p['name'].casefold(),p['id']))
data = {'source':'GeoNames','license':'CC BY 4.0','generated':datetime.date.today().isoformat(),'areas':sorted(areas.values(),key=lambda a:(a['country'],a['name'].casefold()))}
path = pathlib.Path(__file__).resolve().parent.parent/'public/data/uk-places.json'
path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
print(f'{len(areas)} areas; {sum(len(a["places"]) for a in areas.values())} places; {path.stat().st_size} bytes')
