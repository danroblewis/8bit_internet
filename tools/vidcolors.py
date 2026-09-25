# Usage: python3 vidcolors.py <window.png> '<GEOM json>' <out-crop.png>
import sys, json
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB'); g = json.loads(sys.argv[2])
sc = im.size[0] / g['outerW']
box = [int((g['x'] + 8) * sc), int((g['y'] + g['chromeTop'] + 8) * sc), int((g['x'] + g['w'] - 8) * sc), int((g['y'] + g['chromeTop'] + g['h'] - 40) * sc)]
c = im.crop(box); c.save(sys.argv[3])
print('distinct colors in video:', len(set(c.getdata())), 'crop', c.size)
