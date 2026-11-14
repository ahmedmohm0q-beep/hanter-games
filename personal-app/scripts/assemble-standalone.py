import sys
app, b = sys.argv[1], sys.argv[2]
html = open(f'{app}/index.html', encoding='utf-8').read()
css = open(f'{app}/css/app.css', encoding='utf-8').read()
cfg = open(f'{app}/config.js', encoding='utf-8').read()
js = open(f'{b}/app.bundle.js', encoding='utf-8').read()
assert '</script' not in js.lower(), 'bundle contains </script'
assert '</style' not in css.lower()
# إزالة الروابط التي لا تعمل من ملف محلي (manifest وService Worker)
html = html.replace('  <link rel="manifest" href="manifest.webmanifest" />\n', '')
html = html.replace('<link rel="stylesheet" href="css/app.css" />', '<style>\n' + css + '\n</style>')
html = html.replace('<script src="config.js"></script>', '<script>\n' + cfg + '\n</script>')
html = html.replace('<script type="module" src="src/main.js"></script>', '<script>\n' + js + '\n</script>')
for leftover in ['css/app.css', 'src/main.js', 'config.js"', 'manifest.webmanifest']:
    assert leftover not in html, f'leftover reference: {leftover}'
open(f'{b}/tatawwur.html', 'w', encoding='utf-8').write(html)
print('written', len(html), 'bytes')
