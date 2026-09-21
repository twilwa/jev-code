import sys, json
sys.path.insert(0, "/home/firstmate/.local/share/uv/tools/cmind-cli/lib/python3.12/site-packages/cmind_cli/core_pack/scripts")
from lang_parser import registry
from common.code_dedup import dedup_file_code, dedup_code_blocks

path = sys.argv[1]
code = open(path, encoding="utf8").read()
parser = registry.get_parser_for_file(path)
res = parser.parse_file(path, code)
units = res.units
print(f"file={path} lines={len(code.splitlines())} units={len(units)}")
overlaps = []
for i, a in enumerate(units):
    for b in units[i+1:]:
        if a.line_start is None or b.line_start is None: continue
        if a.line_start <= b.line_start and b.line_end <= a.line_end and (a.line_start, a.line_end) != (b.line_start, b.line_end):
            overlaps.append((a.unit_type, a.name, a.line_start, a.line_end, b.unit_type, b.name, b.line_start, b.line_end))
print(f"strictly-nested unit pairs: {len(overlaps)}")
for o in overlaps[:8]:
    print(f"  {o[0]} {o[1]} [{o[2]}-{o[3]}] CONTAINS {o[4]} {o[5]} [{o[6]}-{o[7]}]")
joined = dedup_file_code(u.code for u in units)
print(f"original file bytes = {len(code)}")
print(f"dedup_file_code bytes = {len(joined)}  (ratio {len(joined)/len(code):.2f}x)")
uniq = dedup_code_blocks([u.code for u in units])
print(f"blocks in: {len(units)}  blocks surviving dedup: {len(uniq)}")
