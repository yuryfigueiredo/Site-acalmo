from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

assets = Path(__file__).resolve().parents[1] / 'src' / 'assets'

# Same tones as icon.svg: brand green on paper. The rings are the .35 and .5 opacities of the
# svg pre-blended, because PIL writes RGB and a maskable icon must stay fully opaque.
PAPER = '#eef5f0'
RING_THIN = '#9bbdbc'
RING_BOLD = '#77a5a6'
BRAND = '#00545b'

for size in (192, 512):
    im = Image.new('RGB', (size, size), PAPER)
    draw = ImageDraw.Draw(im)
    for ratio, tone in ((.21, RING_THIN), (.27, RING_BOLD)):
        inset = int(size * ratio)
        draw.ellipse((inset, inset, size-inset, size-inset), outline=tone, width=max(1, size//256))
    font = ImageFont.truetype('C:/Windows/Fonts/pala.ttf', int(size*.68))
    draw.text((size*.5, size*.46), 'a', font=font, fill=BRAND, anchor='mm')
    im.save(assets / f'icon-{size}.png', optimize=True)
print('Ícones 192 e 512 gerados.')
