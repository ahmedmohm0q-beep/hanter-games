import csv,json,re,unicodedata
L='../library.json'
lib=json.load(open(L))
def norm(s): return re.sub(r'[ً-ْـ\W_]','',unicodedata.normalize('NFKC',s)).replace('أ','ا').replace('إ','ا').replace('آ','ا').lower()
seen={norm(q['text']) for q in lib['quotes']}
ids={q['id'] for q in lib['quotes']}
def slug(s):
  s=unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower()
  return re.sub(r'[^a-z0-9]+','-',s).strip('-')[:24]
FIX={  # rows where I changed the page text
 'وَمَن يَكُ ذا':None}
def note(lang,row,text):
  n=[]
  a=row[1]
  if lang=='ar':
    n.append('ملكية عامة؛ النص منقول من الصفحة المرتبطة كما هو (التشكيل من المصدر).')
    if 'منسوب' in a or 'الشافعي' in a: n.append('النسبة مشهورة وليست قطعية.')
    if 'ابن الوردي' in a or 'الرصافي' in a or 'تيقظ' in row[3]: n.append('تقسيم الشطرين أو وصل كلمة مقطوعة في الصفحة تمّ منّا.')
    if 'البستي' in a or 'الفتح' in a: n.append('صُحّحت أخطاء طباعية ظاهرة في الصفحة.')
    if 'شوقي' in a and 'ابناً' in text: n.append('صُحّح «أبناً» إلى «ابناً».')
  else:
    n.append('Public domain (author died long ago; translation pre-1929 where applicable). Copied from the linked page.')
    if 'a-fishing' in text: n.append('Dash normalized from the page.')
    if 'thirteen virtues' in row[3]: n.append('Virtue name added before its precept as on the page.')
  return ' '.join(n)
added={'ar':0,'en':0}
for lang,fn,trf in [('ar','ar_batch1.tsv','ar_tr.py'),('en','en_batch1.tsv','en_tr.py')]:
  g={};exec(open(trf).read(),g);T,D=g['T'],g['DROP']
  rows=list(csv.reader(open(fn),delimiter='\t',quoting=csv.QUOTE_NONE))[1:]
  for i,r in enumerate(rows):
    if i in D: continue
    text=r[0].strip()
    k=norm(text)
    if k in seen: continue
    seen.add(k)
    base=f"{lang}-{slug(r[2])}-{i:03d}"
    q=dict(id=base,lang=lang,text=text,translation=T[i],translationBy='app',author=r[1],authorAlt=r[2],work=r[3],year=r[4],sourceUrl=r[5],sourceNote=note(lang,r,text),verifiedOn='2026-11-03')
    assert q['id'] not in ids; ids.add(q['id'])
    lib['quotes'].append(q); added[lang]+=1
c={'ar':0,'en':0}
for q in lib['quotes']: c[q['lang']]+=1
lib['verifiedCount']=c
lib['status']='growing' 
json.dump(lib,open(L,'w'),ensure_ascii=False,indent=2)
open(L,'a').write('\n')
print(added,c,sum(c.values()))
