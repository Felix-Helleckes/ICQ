"""Measure integrated loudness and true peak of a media file with ffmpeg's ebur128.
usage: python loud.py <file>   ->  prints "<LUFS> <dBTP>"
"""
import re
import subprocess
import sys

p = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", sys.argv[1],
                    "-af", "ebur128=peak=true", "-f", "null", "-"],
                   capture_output=True, text=True, encoding="utf-8", errors="replace")
tail = p.stderr[p.stderr.rfind("Summary:"):]
i = re.search(r"I:\s*(-?[\d.]+)\s*LUFS", tail)
tp = re.search(r"Peak:\s*(-?[\d.]+)\s*dBFS", tail)
if not i:
    sys.stderr.write(p.stderr[-2000:])
    sys.exit("could not read loudness")
print(i.group(1), tp.group(1) if tp else "nan")
