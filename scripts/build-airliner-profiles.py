"""Extract airliner planning figures from the FAA October 2024 Aircraft Characteristics Database.

Run with the publisher's local workbook as the sole argument. Source and dictionary:
https://www.faa.gov/airports/engineering/aircraft_char_database
"""
import hashlib
import json
from pathlib import Path
import sys
from xml.etree import ElementTree
from zipfile import ZipFile


WORKBOOK_SHA256 = '3e68848b6bb99f9700e25d33c080b993a80dc962d581a391f89aee94b6c8fcb3'
AIRLINERS = set("""
A19N A20N A21N A306 A30B A310 A318 A319 A320 A321 A332 A333 A338 A339 A342 A343 A345 A346 A359 A35K A388
AT43 AT44 AT45 AT46 AT72 AT73 AT75 AT76 B37M B38M B39M B461 B462 B703 B712 B721 B722 B732 B733 B734 B735
B736 B737 B738 B739 B741 B742 B743 B744 B748 B752 B753 B762 B763 B764 B772 B773 B778 B779 B77L B77W B788 B789 B78X
BA11 BCS1 BCS3 CRJ1 CRJ2 CRJ7 CRJ9 D328 DC10 DC87 DC91 DC93 DC95 DH8A DH8B DH8C DH8D DHC6 DHC7
E110 E120 E135 E145 E170 E190 E195 E290 E295 E45X E75L E75S J328 JS31 JS32 JS41 MD11 MD81 MD82 MD83 MD87 MD88 MD90
RJ1H RJ85 SB20 SF34 SH33 SH36 SU95
""".split())


def extract(path):
    if hashlib.sha256(path.read_bytes()).hexdigest() != WORKBOOK_SHA256:
        raise ValueError('Unexpected workbook version. Check the FAA field definitions before updating the digest.')
    with ZipFile(path) as archive:
        strings = [''.join(entry.itertext()) for entry in ElementTree.fromstring(archive.read('xl/sharedStrings.xml'))]
        rows = ElementTree.fromstring(archive.read('xl/worksheets/sheet1.xml')).findall('.//{*}row')
    catalog = {}
    for row in rows[1:]:
        cells = {}
        for cell in row:
            value = cell.findtext('{*}v')
            if value is not None:
                cells[cell.get('r').rstrip('0123456789')] = strings[int(value)] if cell.get('t') == 's' else value
        code = cells.get('A')
        if code not in AIRLINERS:
            continue
        if code in catalog:
            raise ValueError(f'Multiple records for ICAO {code}. Review the variants.')
        data = {'model': cells['D'], 'propulsion': cells['F'], 'engineCount': int(cells['G'])}
        for column, field in [('R', 'lengthM'), ('P', 'spanWithoutTipsM'), ('Q', 'spanWithTipsM'), ('S', 'tailHeightM')]:
            if cells.get(column) not in (None, 'N/A'):
                data[field] = round(float(cells[column]) * 0.3048, 1)
        if cells.get('W') not in (None, 'N/A'):
            data['takeoffKg'] = round(float(cells['W']) * 0.45359237 / 100) * 100
        catalog[code] = data
    if AIRLINERS != catalog.keys():
        raise ValueError(f'Missing FAA records: {AIRLINERS - catalog.keys()}')
    return catalog


if __name__ == '__main__':
    profiles = extract(Path(sys.argv[1]))
    output = Path(__file__).resolve().parents[1] / 'src/shared/airlinerCharacteristics.json'
    lines = [f'  "{code}": {json.dumps(row, ensure_ascii=False)}' for code, row in sorted(profiles.items())]
    output.write_text('{\n' + ',\n'.join(lines) + '\n}\n', encoding='utf-8', newline='\n')
