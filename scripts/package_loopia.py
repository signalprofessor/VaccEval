"""Create a ZIP containing only the validated static Loopia deployment."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import argparse

p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
if not (a.source/'index.html').is_file(): raise SystemExit('Missing static index.html')
for forbidden in ('PersonID','KontaktID','Födelsedatum'):
    for file in a.source.rglob('*'):
        if file.is_file() and file.suffix.lower() in {'.html','.js','.json','.css','.txt'}:
            if forbidden in file.read_text(errors='ignore'): raise SystemExit(f'Privacy check failed: {forbidden} in {file}')
a.output.parent.mkdir(parents=True,exist_ok=True)
with ZipFile(a.output,'w',ZIP_DEFLATED) as z:
    for file in sorted(a.source.rglob('*')):
        if file.is_file(): z.write(file,file.relative_to(a.source))
print(a.output)
