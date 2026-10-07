import json
GH={"authentication":"predefinedCredentialType","nodeCredentialType":"githubApi"}
GHC={"githubApi":{"id":"aifeedGithub0001","name":"GitHub aifeed (fine-grained PAT)"}}
ANTC={"httpHeaderAuth":{"id":"aifeedAnthrop001","name":"Anthropic x-api-key"}}
IGC={"httpQueryAuth":{"id":"aifeedMetaIG0001","name":"Meta IG long-lived token (access_token)"}}
LIC={"linkedInOAuth2Api":{"id":"aifeedLinkedIn01","name":"LinkedIn OAuth2"}}
CFG="$('Config').first().json"
nodes=[];conn={};prev=None
def add(name,typ,ver,params,creds=None,extra=None,link=True):
    global prev
    n={"id":name.lower().replace(' ','-'),"name":name,"type":typ,"typeVersion":ver,"position":[len(nodes)*220,0],"parameters":params}
    if creds:n["credentials"]=creds
    if extra:n.update(extra)
    nodes.append(n)
    if prev and link: conn[prev]={"main":[[{"node":name,"type":"main","index":0}]]}
    prev=name
def http(name,method,url,creds=None,body=None,extra_params=None,auth=None,extra=None):
    p={"method":method,"url":url,"options":{}}
    if auth:p.update(auth)
    if body is not None:p.update({"sendBody":True,"specifyBody":"json","jsonBody":body})
    if extra_params:p.update(extra_params)
    add(name,"n8n-nodes-base.httpRequest",4.2,p,creds,extra)
def code(name,js,extra=None): add(name,"n8n-nodes-base.code",2,{"mode":"runOnceForAllItems","jsCode":js},extra=extra)
R=lambda f:open(f).read()

add("Schedule 8am+5pm ET","n8n-nodes-base.scheduleTrigger",1.2,{"rule":{"interval":[{"field":"cronExpression","expression":"0 8,17 * * *"}]}})
add("Config","n8n-nodes-base.set",3.4,{"mode":"raw","jsonOutput":"={\n \"repo\": \"xavidalmau9/aifeed\",\n \"branch\": \"main\",\n \"siteUrl\": \"https://aifeed.run\",\n \"igUserId\": \"17841442136197946\",\n \"fbPageId\": \"1434982969687864\",\n \"metaAppId\": \"1367205021940381\",\n \"graphVersion\": \"v21.0\",\n \"linkedinAuthorUrn\": \"urn:li:person:REPLACE (or urn:li:organization:REPLACE)\",\n \"linkedinVersion\": \"202509\",\n \"endCardUrl\": \"https://aifeed.run/images/aifeed_endslide.png\",\n \"telegramChatId\": \"7748417469\",\n \"renderUrl\": \"http://127.0.0.1:3000\",\n \"anthropicModel\": \"claude-haiku-4-5\",\n \"today\": \"{{ $now.setZone('America/New_York').toFormat('yyyy-MM-dd') }}\",\n \"slot\": {{ $now.setZone('America/New_York').hour < 12 ? 1 : 2 }},\n \"fbEnabled\": false,\n \"dryRun\": false,\n \"dryRunDir\": \"/home/box/aifeed-n8n/dryrun\",\n \"dedupDays\": 30,\n \"similarityThreshold\": 0.5\n}"})
neverErr={"options":{"response":{"response":{"neverError":True}}}}
http("GH Get History","GET","=https://api.github.com/repos/{{ "+CFG+".repo }}/contents/_data/history.json",GHC,auth=GH,extra_params=neverErr)
# Website history: retry once, then continue so the code node can fall back to raw/site JSON (and stop safely if all fail)
http("GH Get Posts Index","GET","=https://api.github.com/repos/{{ "+CFG+".repo }}/contents/_posts/posts-index.json",GHC,auth=GH,extra={"retryOnFail":True,"maxTries":2,"waitBetweenTries":5000,"onError":"continueRegularOutput","alwaysOutputData":True})
# Instagram history: last 100 captions (retry once; on failure dedupe continues with website + log)
http("IG Get Recent Media","GET","=https://graph.facebook.com/{{ "+CFG+".graphVersion }}/{{ "+CFG+".igUserId }}/media",IGC,auth={"authentication":"genericCredentialType","genericAuthType":"httpQueryAuth","sendQuery":True,"queryParameters":{"parameters":[{"name":"fields","value":"caption,timestamp"},{"name":"limit","value":"100"}]}},extra={"retryOnFail":True,"maxTries":2,"waitBetweenTries":5000,"onError":"continueRegularOutput","alwaysOutputData":True})
code("Fetch RSS + Dedup",R("js/dedup_lib.js")+"\n"+R("js/fetch_dedup.js"))
rank_body="={{ JSON.stringify({model: "+CFG+".anthropicModel, max_tokens: 2500, messages:[{role:'user', content: $json.rankPrompt}]}) }}"
http("Claude Rank","POST","https://api.anthropic.com/v1/messages",ANTC,body=rank_body,auth={"authentication":"genericCredentialType","genericAuthType":"httpHeaderAuth","sendHeaders":True,"headerParameters":{"parameters":[{"name":"anthropic-version","value":"2023-06-01"}]}},extra={"retryOnFail":True,"maxTries":3,"waitBetweenTries":5000})
code("Pick Slot Story",R("js/pick_slot.js"))
# Semantic same-event check: same company + same announcement/incident as anything already posted -> skip
http("Claude Same-Event Check","POST","https://api.anthropic.com/v1/messages",ANTC,body="={{ JSON.stringify({model: "+CFG+".anthropicModel, max_tokens: 3000, temperature: 0, messages:[{role:'user', content: $json.sameEventPrompt}]}) }}",auth={"authentication":"genericCredentialType","genericAuthType":"httpHeaderAuth","sendHeaders":True,"headerParameters":{"parameters":[{"name":"anthropic-version","value":"2023-06-01"}]}},extra={"retryOnFail":True,"maxTries":3,"waitBetweenTries":5000})
code("Drop Same-Event Repeats",R("js/same_event_filter.js"))
code("Fetch Articles",R("js/fetch_articles.js"))
http("Claude Captions + Fact Check","POST","https://api.anthropic.com/v1/messages",ANTC,body="={{ JSON.stringify({model: "+CFG+".anthropicModel, max_tokens: 6000, messages:[{role:'user', content: $json.captionPrompt}]}) }}",auth={"authentication":"genericCredentialType","genericAuthType":"httpHeaderAuth","sendHeaders":True,"headerParameters":{"parameters":[{"name":"anthropic-version","value":"2023-06-01"}]}},extra={"retryOnFail":True,"maxTries":3,"waitBetweenTries":5000})
code("Quality Checks + Build HTML",R("js/captions_lib.js")+"\n"+R("js/qc_html.js"))
add("Render PNG (Gotenberg)","n8n-nodes-base.httpRequest",4.2,{"method":"POST","url":"={{ "+CFG+".renderUrl }}/forms/chromium/screenshot/html","sendBody":True,"contentType":"multipart-form-data","bodyParameters":{"parameters":[{"parameterType":"formBinaryData","name":"files","inputDataFieldName":"html"},{"name":"width","value":"1080"},{"name":"height","value":"1350"},{"name":"clip","value":"true"},{"name":"format","value":"png"},{"name":"waitDelay","value":"3s"}]},"options":{"response":{"response":{"responseFormat":"file","outputPropertyName":"png"}},"timeout":60000}},extra={"retryOnFail":True,"maxTries":2})
code("Validate PNG + Prep Commits",R("js/prep_commits.js"))
put=lambda path,content,sha,msg: "={{ JSON.stringify(Object.assign({message: "+msg+", branch: "+CFG+".branch, content: "+content+"}, "+sha+" ? {sha: "+sha+"} : {})) }}"
http("GH Commit Image","PUT","=https://api.github.com/repos/{{ "+CFG+".repo }}/contents/images/{{ $json.pngName }}",GHC,body="={{ JSON.stringify({message: 'AIFeed image: ' + $json.pngName, branch: "+CFG+".branch, content: $json.pngBase64}) }}",auth=GH)
P="$('Validate PNG + Prep Commits').first().json"
http("GH Update Posts Index","PUT","=https://api.github.com/repos/{{ "+CFG+".repo }}/contents/_posts/posts-index.json",GHC,body=put(0,P+".postsBase64",P+".postsSha","'Publish: ' + "+P+".post.headline.substring(0,60)"),auth=GH)
http("GH Update History","PUT","=https://api.github.com/repos/{{ "+CFG+".repo }}/contents/_data/history.json",GHC,body=put(0,P+".historyBase64",P+".historySha","'History: ' + "+P+".post.slug"),auth=GH)
add("Wait for GitHub Pages","n8n-nodes-base.wait",1.1,{"amount":90,"unit":"seconds"})
http("Check Image Is Public","GET","={{ "+P+".post.imageUrl }}",extra_params={"options":{"response":{"response":{"responseFormat":"file"}}}},extra={"retryOnFail":True,"maxTries":5,"waitBetweenTries":30000})
IGA=lambda params:{"authentication":"genericCredentialType","genericAuthType":"httpQueryAuth","sendBody":True,"contentType":"form-urlencoded","bodyParameters":{"parameters":params}}
GURL="=https://graph.facebook.com/{{ "+CFG+".graphVersion }}/"
http("IG Child 1 (Story)","POST",GURL+"{{ "+CFG+".igUserId }}/media",IGC,auth=IGA([{"name":"image_url","value":"={{ "+P+".post.imageUrl }}"},{"name":"is_carousel_item","value":"true"}]),extra={"retryOnFail":True,"maxTries":3,"waitBetweenTries":15000})
http("IG Child 2 (End Card)","POST",GURL+"{{ "+CFG+".igUserId }}/media",IGC,auth=IGA([{"name":"image_url","value":"={{ "+CFG+".endCardUrl }}"},{"name":"is_carousel_item","value":"true"}]),extra={"retryOnFail":True,"maxTries":3,"waitBetweenTries":15000})
http("IG Create Carousel","POST",GURL+"{{ "+CFG+".igUserId }}/media",IGC,auth=IGA([{"name":"media_type","value":"CAROUSEL"},{"name":"children","value":"={{ $('IG Child 1 (Story)').first().json.id }},{{ $('IG Child 2 (End Card)').first().json.id }}"},{"name":"caption","value":"={{ "+P+".igCaption }}"}]))
add("Wait IG Processing","n8n-nodes-base.wait",1.1,{"amount":15,"unit":"seconds"})
http("IG Get Status","GET",GURL+"{{ $('IG Create Carousel').first().json.id }}?fields=status_code,status",IGC,auth={"authentication":"genericCredentialType","genericAuthType":"httpQueryAuth"})
code("IG Check Status","const s = $input.first().json.status_code;\nconst attempt = $runIndex + 1;\nif (s === 'ERROR' || s === 'EXPIRED') throw new Error('IG carousel container ' + s + ': ' + ($input.first().json.status || ''));\nif (s !== 'FINISHED' && attempt >= 12) throw new Error('IG carousel not FINISHED after ' + attempt + ' polls (last: ' + s + ')');\nreturn [{ json: { ready: s === 'FINISHED', status_code: s, attempt } }];")
add("IG Ready?","n8n-nodes-base.if",2,{"conditions":{"options":{"caseSensitive":True,"typeValidation":"loose"},"conditions":[{"id":"r","leftValue":"={{ $json.ready }}","rightValue":True,"operator":{"type":"boolean","operation":"true","singleValue":True}}],"combinator":"and"},"options":{}})
http("IG Publish","POST",GURL+"{{ "+CFG+".igUserId }}/media_publish",IGC,auth=IGA([{"name":"creation_id","value":"={{ $('IG Create Carousel').first().json.id }}"}]),extra={"retryOnFail":True,"maxTries":3,"waitBetweenTries":20000})
LIH={"authentication":"predefinedCredentialType","nodeCredentialType":"linkedInOAuth2Api","sendHeaders":True,"headerParameters":{"parameters":[{"name":"LinkedIn-Version","value":"={{ "+CFG+".linkedinVersion }}"},{"name":"X-Restli-Protocol-Version","value":"2.0.0"}]}}
INIT="={{ JSON.stringify({initializeUploadRequest:{owner: "+CFG+".linkedinAuthorUrn}}) }}"
http("LI Init Upload (Story)","POST","https://api.linkedin.com/rest/images?action=initializeUpload",LIC,body=INIT,auth=LIH)
code("Attach Story PNG","const png = $('Render PNG (Gotenberg)').first().binary;\nreturn [{ json: $input.first().json.value, binary: png }];")
http("LI Upload Story","PUT","={{ $json.uploadUrl }}",LIC,auth={"authentication":"predefinedCredentialType","nodeCredentialType":"linkedInOAuth2Api","sendBody":True,"contentType":"binaryData","inputDataFieldName":"png"})
http("LI Init Upload (End Card)","POST","https://api.linkedin.com/rest/images?action=initializeUpload",LIC,body=INIT,auth=LIH)
http("Download End Card","GET","={{ "+CFG+".endCardUrl }}",extra_params={"options":{"response":{"response":{"responseFormat":"file","outputPropertyName":"png"}}}})
http("LI Upload End Card","PUT","={{ $('LI Init Upload (End Card)').first().json.value.uploadUrl }}",LIC,auth={"authentication":"predefinedCredentialType","nodeCredentialType":"linkedInOAuth2Api","sendBody":True,"contentType":"binaryData","inputDataFieldName":"png"})
http("LI Create Post","POST","https://api.linkedin.com/rest/posts",LIC,body="={{ JSON.stringify({author: "+CFG+".linkedinAuthorUrn, commentary: "+P+".liCaption.replace(/[\\\\(){}\\[\\]<>@|~_*#]/g, m => '\\\\' + m), visibility:'PUBLIC', distribution:{feedDistribution:'MAIN_FEED', targetEntities:[], thirdPartyDistributionChannels:[]}, content:{multiImage:{images:[{id: $('LI Init Upload (Story)').first().json.value.image, altText: "+P+".post.headline}, {id: $('LI Init Upload (End Card)').first().json.value.image, altText: 'Follow AIFeed.run - AI News Delivered by AI'}]}}, lifecycleState:'PUBLISHED', isReshareDisabledByAuthor:false}) }}",auth=LIH)

# ── Instagram Story branch (runs after IG Publish, parallel to LinkedIn; failures only alert) ──
TGC={"telegramApi":{"id":"aifeedTelegram01","name":"Telegram AIFeed bot (NEW token)"}}
SOE={"onError":"continueErrorOutput"}
story_nodes=[]
SH="Story: Attach HTML"
add(SH,"n8n-nodes-base.code",2,{"mode":"runOnceForAllItems","jsCode":"return [{ json: {}, binary: { storyHtml: $('Quality Checks + Build HTML').first().binary.storyHtml } }];"},extra=dict(SOE),link=False); story_nodes.append(SH)
def S(fn,*a,**k):
    global prev
    prev=None
    ex=dict(k.pop('extra',None) or {}); ex.update(SOE); k['extra']=ex
    if fn is add: k['link']=False
    fn(*a,**k); story_nodes.append(nodes[-1]['name'])
S(add,"Story: Render PNG","n8n-nodes-base.httpRequest",4.2,{"method":"POST","url":"={{ "+CFG+".renderUrl }}/forms/chromium/screenshot/html","sendBody":True,"contentType":"multipart-form-data","bodyParameters":{"parameters":[{"parameterType":"formBinaryData","name":"files","inputDataFieldName":"storyHtml"},{"name":"width","value":"1080"},{"name":"height","value":"1920"},{"name":"clip","value":"true"},{"name":"format","value":"png"},{"name":"waitDelay","value":"3s"}]},"options":{"response":{"response":{"responseFormat":"file","outputPropertyName":"png"}},"timeout":60000}},extra={"retryOnFail":True,"maxTries":2})
S(code,"Story: Validate + Prep",R("js/prep_story.js"))
S(http,"Story: GH Commit Image","PUT","=https://api.github.com/repos/{{ "+CFG+".repo }}/contents/images/{{ $json.storyName }}",GHC,body="={{ JSON.stringify({message: 'AIFeed story image: ' + $json.storyName, branch: "+CFG+".branch, content: $json.storyBase64}) }}",auth=GH)
S(add,"Story: Wait for Pages","n8n-nodes-base.wait",1.1,{"amount":90,"unit":"seconds"})
SP="$('Story: Validate + Prep').first().json"
S(http,"Story: Check Image Public","GET","={{ "+SP+".storyUrl }}",extra_params={"options":{"response":{"response":{"responseFormat":"file"}}}},extra={"retryOnFail":True,"maxTries":5,"waitBetweenTries":30000})
S(http,"Story: IG Create Container","POST",GURL+"{{ "+CFG+".igUserId }}/media",IGC,auth=IGA([{"name":"media_type","value":"STORIES"},{"name":"image_url","value":"={{ "+SP+".storyUrl }}"}]),extra={"retryOnFail":True,"maxTries":3,"waitBetweenTries":15000})
S(add,"Story: Wait Processing","n8n-nodes-base.wait",1.1,{"amount":10,"unit":"seconds"})
S(http,"Story: IG Get Status","GET",GURL+"{{ $('Story: IG Create Container').first().json.id }}?fields=status_code,status",IGC,auth={"authentication":"genericCredentialType","genericAuthType":"httpQueryAuth"})
S(code,"Story: Check Status","const s = $input.first().json.status_code;\nconst attempt = $runIndex + 1;\nif (s === 'ERROR' || s === 'EXPIRED') throw new Error('IG story container ' + s + ': ' + ($input.first().json.status || ''));\nif (s !== 'FINISHED' && attempt >= 12) throw new Error('IG story not FINISHED after ' + attempt + ' polls (last: ' + s + ')');\nreturn [{ json: { ready: s === 'FINISHED', status_code: s, attempt } }];")
S(add,"Story: Ready?","n8n-nodes-base.if",2,{"conditions":{"options":{"caseSensitive":True,"typeValidation":"loose"},"conditions":[{"id":"r","leftValue":"={{ $json.ready }}","rightValue":True,"operator":{"type":"boolean","operation":"true","singleValue":True}}],"combinator":"and"},"options":{}})
S(http,"Story: IG Publish","POST",GURL+"{{ "+CFG+".igUserId }}/media_publish",IGC,auth=IGA([{"name":"creation_id","value":"={{ $('Story: IG Create Container').first().json.id }}"}]),extra={"retryOnFail":True,"maxTries":3,"waitBetweenTries":20000})
prev=None
add("Story Failed Alert","n8n-nodes-base.telegram",1.2,{"chatId":"={{ "+CFG+".telegramChatId }}","text":"=⚠️ AIFeed: Instagram Story failed (feed post + LinkedIn unaffected)\nStep: {{ $json.error ? '' : '' }}{{ $prevNode.name }}\nError: {{ $json.error?.message || $json.error || JSON.stringify($json).slice(0,300) }}","additionalFields":{"appendAttribution":False}},TGC,link=False)
ALERT=[{"node":"Story Failed Alert","type":"main","index":0}]
for i,n in enumerate(story_nodes):
    nxt=story_nodes[i+1] if i+1<len(story_nodes) else None
    if n=="Story: Ready?":
        conn[n]={"main":[[{"node":"Story: IG Publish","type":"main","index":0}],[{"node":"Story: Wait Processing","type":"main","index":0}]]}
    elif nxt:
        conn[n]={"main":[[{"node":nxt,"type":"main","index":0}],ALERT]}
    else:
        conn[n]={"main":[[],ALERT]}
for i,n in enumerate(story_nodes): 
    node=[x for x in nodes if x['name']==n][0]; node['position']=[(i+18)*220,320]
nodes[-1]['position']=[(len(story_nodes)+18)*220,520]
for x in nodes:
    if x["name"] in ("Story: Ready?",): x.pop("onError",None)
    if x["name"]=="Story Failed Alert": x["onError"]="continueRegularOutput"
conn["IG Publish"]["main"][0].append({"node":SH,"type":"main","index":0})

# IF branching: true -> IG Publish, false -> loop back to Wait
conn["IG Ready?"]={"main":[[{"node":"IG Publish","type":"main","index":0}],[{"node":"Wait IG Processing","type":"main","index":0}]]}
# ───────── post-processing: public-URL polling, optional LinkedIn, LI retry, layout check, dry run, Facebook, manual trigger ─────────
def N(name): return [x for x in nodes if x["name"]==name][0]
def mk(name,typ,ver,params,pos,creds=None,extra=None):
    n={"id":name.lower().replace(' ','-').replace(':','').replace('?',''),"name":name,"type":typ,"typeVersion":ver,"position":pos,"parameters":params}
    if creds:n["credentials"]=creds
    if extra:n.update(extra)
    nodes.append(n); return name
L=lambda *names:[{"node":x,"type":"main","index":0} for x in names]
IFP=lambda expr:{"conditions":{"options":{"caseSensitive":True,"typeValidation":"loose"},"conditions":[{"id":"c","leftValue":expr,"rightValue":True,"operator":{"type":"boolean","operation":"true","singleValue":True}}],"combinator":"and"},"options":{}}
POLL="const st = $input.first().json.statusCode;\nconst attempt = $runIndex + 1;\nif (st !== 200 && attempt >= 9) throw new Error('Image URL still not public after ~5 min (HTTP ' + st + ')');\nreturn [{ json: { ready: st === 200, statusCode: st, attempt } }];"
def url_poll(prefix,wait_node,check_node,next_node,soe):
    N(wait_node)["parameters"]["amount"]=60
    c=N(check_node); c.pop("retryOnFail",None); c.pop("maxTries",None); c.pop("waitBetweenTries",None)
    c["parameters"]["options"]={"response":{"response":{"fullResponse":True,"neverError":True,"responseFormat":"text"}},"timeout":20000}
    x=N(check_node)["position"]
    a=mk(prefix+"Image Live?","n8n-nodes-base.code",2,{"mode":"runOnceForAllItems","jsCode":POLL},[x[0],x[1]+200],extra=dict(SOE) if soe else None)
    i=mk(prefix+"Image Ready?","n8n-nodes-base.if",2,IFP("={{ $json.ready }}"),[x[0]+220,x[1]+200])
    w=mk(prefix+"Wait 30s Retry","n8n-nodes-base.wait",1.1,{"amount":30,"unit":"seconds"},[x[0]+440,x[1]+200])
    old_err=conn[check_node]["main"][1] if len(conn[check_node]["main"])>1 else None
    conn[check_node]={"main":[L(a)]+([old_err] if old_err else [])}
    conn[a]={"main":[L(i)]+([ALERT] if soe else [])}
    conn[i]={"main":[L(next_node),L(w)]}
    conn[w]={"main":[L(check_node)]}
url_poll("","Wait for GitHub Pages","Check Image Is Public","IG Child 1 (Story)",False)
url_poll("Story: ","Story: Wait for Pages","Story: Check Image Public","Story: IG Create Container",True)

# optional LinkedIn
p=N("IG Publish")["position"]
mk("LinkedIn Enabled?","n8n-nodes-base.if",2,IFP("={{ /^urn:li:(person|organization):[A-Za-z0-9_-]+$/.test("+CFG+".linkedinAuthorUrn || '') }}"),[p[0]+220,p[1]-200])
conn["IG Publish"]={"main":[L("LinkedIn Enabled?",SH)]}
conn["LinkedIn Enabled?"]={"main":[L("LI Init Upload (Story)"),[]]}

# layout check + LinkedIn caption too short -> one regeneration, then accept with warning
q=N("Quality Checks + Build HTML")["position"]
mk("Layout Check","n8n-nodes-base.code",2,{"mode":"runOnceForAllItems","jsCode":R("js/captions_lib.js")+"""
// Final gate: re-validates the assembled IG caption exactly as it will be posted.
const it = $input.first();
const errs = [...checkIg(it.json.gen.igCaption, it.json.story.link), ...checkAccuracy(it.json.gen, it.json.story).map(x => 'accuracy: ' + x)];
if (errs.length) throw new Error('IG caption layout/accuracy check failed: ' + errs.join('; '));
return [it];"""},[q[0]+60,q[1]-450])
mk("LI Caption Short?","n8n-nodes-base.if",2,IFP("={{ $json.liShort === true }}"),[q[0]+110,q[1]-250])
mk("Claude Expand LinkedIn","n8n-nodes-base.httpRequest",4.2,{"method":"POST","url":"https://api.anthropic.com/v1/messages","authentication":"genericCredentialType","genericAuthType":"httpHeaderAuth","sendHeaders":True,"headerParameters":{"parameters":[{"name":"anthropic-version","value":"2023-06-01"}]},"sendBody":True,"specifyBody":"json","jsonBody":"={{ JSON.stringify({model: "+CFG+".anthropicModel, max_tokens: 2000, messages:[{role:'user', content: $json.liExpandPrompt}]}) }}","options":{}},[q[0]+330,q[1]-250],ANTC,extra={"onError":"continueRegularOutput","retryOnFail":True,"maxTries":2})
mk("Merge LI Caption","n8n-nodes-base.code",2,{"mode":"runOnceForAllItems","jsCode":R("js/captions_lib.js")+"""
const q = $('Quality Checks + Build HTML').first();
const t = ($input.first().json?.content?.[0]?.text || '');
let liCaption = q.json.gen.liCaption, liWarning = null;
try {
  const p = JSON.parse((t.match(/\\{[\\s\\S]*\\}/) || ['{}'])[0]);
  const cand = buildLi({ ...q.json.gen, ...p }, q.json.story.link);
  const w = cand.split(/\\s+/).length;
  if (p.liParagraphs && checkLi(cand).length === 0 && w >= 200) liCaption = cand; else liWarning = 'LinkedIn caption short after retry - posted anyway';
} catch (e) { liWarning = 'LinkedIn retry unparseable - posted original'; }
return [{ json: { liCaption, liWarning }, binary: q.binary }];"""},[q[0]+550,q[1]-250])
# accuracy gate: one regeneration of the best candidate's copy, then QC re-runs (and falls back to the next candidate)
mk("Accuracy Fix Needed?","n8n-nodes-base.if",2,IFP("={{ $json.accuracyRetry === true }}"),[q[0]-110,q[1]-650])
mk("Claude Fix Accuracy","n8n-nodes-base.httpRequest",4.2,{"method":"POST","url":"https://api.anthropic.com/v1/messages","authentication":"genericCredentialType","genericAuthType":"httpHeaderAuth","sendHeaders":True,"headerParameters":{"parameters":[{"name":"anthropic-version","value":"2023-06-01"}]},"sendBody":True,"specifyBody":"json","jsonBody":"={{ JSON.stringify({model: "+CFG+".anthropicModel, max_tokens: 3000, temperature: 0, messages:[{role:'user', content: $json.accuracyPrompt}]}) }}","options":{}},[q[0]+110,q[1]-650],ANTC,extra={"onError":"continueRegularOutput","retryOnFail":True,"maxTries":2,"waitBetweenTries":5000})
conn["Quality Checks + Build HTML"]={"main":[L("Accuracy Fix Needed?")]}
conn["Accuracy Fix Needed?"]={"main":[L("Claude Fix Accuracy"),L("Layout Check")]}
conn["Claude Fix Accuracy"]={"main":[L("Quality Checks + Build HTML")]}
conn["Layout Check"]={"main":[L("LI Caption Short?")]}
conn["LI Caption Short?"]={"main":[L("Claude Expand LinkedIn"),L("Render PNG (Gotenberg)")]}
conn["Claude Expand LinkedIn"]={"main":[L("Merge LI Caption")]}
conn["Merge LI Caption"]={"main":[L("Render PNG (Gotenberg)")]}

# dry run branch
p=N("Validate PNG + Prep Commits")["position"]
mk("Dry Run?","n8n-nodes-base.if",2,IFP("={{ "+CFG+".dryRun === true }}"),[p[0]+110,p[1]+500])
conn["Validate PNG + Prep Commits"]={"main":[L("Dry Run?")]}
conn["Dry Run?"]={"main":[L("Dry: Attach HTML"),L("GH Commit Image")]}
Y=p[1]+700; X=p[0]
REATT="const c = $('Dry: Collect').first();\nreturn [{ json: c.json, binary: c.binary }];"
mk("Dry: Attach HTML","n8n-nodes-base.code",2,{"mode":"runOnceForAllItems","jsCode":"return [{ json: {}, binary: { storyHtml: $('Quality Checks + Build HTML').first().binary.storyHtml } }];"},[X,Y])
mk("Dry: Render Story","n8n-nodes-base.httpRequest",4.2,{"method":"POST","url":"={{ "+CFG+".renderUrl }}/forms/chromium/screenshot/html","sendBody":True,"contentType":"multipart-form-data","bodyParameters":{"parameters":[{"parameterType":"formBinaryData","name":"files","inputDataFieldName":"storyHtml"},{"name":"width","value":"1080"},{"name":"height","value":"1920"},{"name":"format","value":"png"},{"name":"waitDelay","value":"3s"}]},"options":{"response":{"response":{"responseFormat":"file","outputPropertyName":"storyPng"}},"timeout":60000}},[X+220,Y])
mk("Dry: Collect","n8n-nodes-base.code",2,{"mode":"runOnceForAllItems","jsCode":"const P = $('Validate PNG + Prep Commits').first().json;\nconst q = $('Quality Checks + Build HTML').first().json;\nconst feed = $('Render PNG (Gotenberg)').first().binary.png;\nconst story = $input.first().binary.storyPng;\nfeed.fileName = P.pngName; story.fileName = P.pngName.replace(/\\.png$/, '_story.png');\nreturn [{ json: { pngName: P.pngName, storyName: story.fileName, headline: q.story.title, url: q.story.link, igCaption: P.igCaption, liCaption: P.liCaption, failures: q.failures }, binary: { feed, story } }];"},[X+440,Y])
mk("Dry: Save Feed PNG","n8n-nodes-base.readWriteFile",1,{"operation":"write","fileName":"={{ "+CFG+".dryRunDir }}/{{ $json.pngName }}","dataPropertyName":"feed","options":{}},[X+660,Y])
mk("Dry: Save Story PNG","n8n-nodes-base.readWriteFile",1,{"operation":"write","fileName":"={{ "+CFG+".dryRunDir }}/{{ $('Dry: Collect').first().json.storyName }}","dataPropertyName":"story","options":{}},[X+880,Y])
mk("Dry: Reattach","n8n-nodes-base.code",2,{"mode":"runOnceForAllItems","jsCode":REATT},[X+990,Y+200])
mk("Dry: TG Feed Photo","n8n-nodes-base.telegram",1.2,{"operation":"sendPhoto","chatId":"={{ "+CFG+".telegramChatId }}","binaryData":True,"binaryPropertyName":"feed","additionalFields":{"caption":"=🧪 DRY RUN (slot {{ "+CFG+".slot }}) — feed graphic\n{{ $('Dry: Collect').first().json.headline }}"}},[X+1100,Y],TGC)
mk("Dry: Reattach 2","n8n-nodes-base.code",2,{"mode":"runOnceForAllItems","jsCode":REATT},[X+1210,Y+200])
mk("Dry: TG Story Photo","n8n-nodes-base.telegram",1.2,{"operation":"sendPhoto","chatId":"={{ "+CFG+".telegramChatId }}","binaryData":True,"binaryPropertyName":"story","additionalFields":{"caption":"🧪 DRY RUN — story graphic"}},[X+1320,Y],TGC)
mk("Dry: TG Caption","n8n-nodes-base.telegram",1.2,{"chatId":"={{ "+CFG+".telegramChatId }}","text":"=🧪 DRY RUN — IG caption (nothing was published)\n\n{{ $('Dry: Collect').first().json.igCaption.substring(0, 3500) }}\n\nSource story: {{ $('Dry: Collect').first().json.url }}","additionalFields":{"appendAttribution":False}},[X+1540,Y],TGC)
for a,b2 in [("Dry: Attach HTML","Dry: Render Story"),("Dry: Render Story","Dry: Collect"),("Dry: Collect","Dry: Save Feed PNG"),("Dry: Save Feed PNG","Dry: Save Story PNG"),("Dry: Save Story PNG","Dry: Reattach"),("Dry: Reattach","Dry: TG Feed Photo"),("Dry: TG Feed Photo","Dry: Reattach 2"),("Dry: Reattach 2","Dry: TG Story Photo"),("Dry: TG Story Photo","Dry: TG Caption")]:
    conn[a]={"main":[L(b2)]}

# Facebook Page branch (optional; failures only alert)
p=N("IG Publish")["position"]; FY=p[1]-450
FBQ=lambda params:{"authentication":"genericCredentialType","genericAuthType":"httpQueryAuth","sendBody":True,"contentType":"form-urlencoded","bodyParameters":{"parameters":params}}
mk("Facebook Enabled?","n8n-nodes-base.if",2,IFP("={{ "+CFG+".fbEnabled === true }}"),[p[0]+220,FY])
FBU="=https://graph.facebook.com/{{ "+CFG+".graphVersion }}/{{ "+CFG+".fbPageId }}/"
FE={"onError":"continueErrorOutput","retryOnFail":True,"maxTries":2,"waitBetweenTries":5000}
mk("FB Upload Photo 1","n8n-nodes-base.httpRequest",4.2,{"method":"POST","url":FBU+"photos",**FBQ([{"name":"url","value":"={{ "+P+".post.imageUrl }}"},{"name":"published","value":"false"}]),"options":{}},[p[0]+440,FY],IGC,extra=dict(FE))
mk("FB Upload Photo 2","n8n-nodes-base.httpRequest",4.2,{"method":"POST","url":FBU+"photos",**FBQ([{"name":"url","value":"={{ "+CFG+".endCardUrl }}"},{"name":"published","value":"false"}]),"options":{}},[p[0]+660,FY],IGC,extra=dict(FE))
mk("FB Create Post","n8n-nodes-base.httpRequest",4.2,{"method":"POST","url":FBU+"feed",**FBQ([{"name":"message","value":"={{ "+P+".igCaption }}"},{"name":"attached_media","value":"={{ JSON.stringify([{media_fbid: $('FB Upload Photo 1').first().json.id}, {media_fbid: $('FB Upload Photo 2').first().json.id}]) }}"}]),"options":{}},[p[0]+880,FY],IGC,extra={"onError":"continueErrorOutput"})
mk("FB Failed Alert","n8n-nodes-base.telegram",1.2,{"chatId":"={{ "+CFG+".telegramChatId }}","text":"=⚠️ AIFeed: Facebook Page post failed (Instagram + website unaffected)\nError: {{ $json.error?.message || $json.error || JSON.stringify($json).slice(0,300) }}","additionalFields":{"appendAttribution":False}},[p[0]+880,FY-200],TGC,extra={"onError":"continueRegularOutput"})
FA=L("FB Failed Alert")
conn["Facebook Enabled?"]={"main":[L("FB Upload Photo 1"),[]]}
conn["FB Upload Photo 1"]={"main":[L("FB Upload Photo 2"),FA]}
conn["FB Upload Photo 2"]={"main":[L("FB Create Post"),FA]}
conn["FB Create Post"]={"main":[[],FA]}
conn["IG Publish"]["main"][0].append({"node":"Facebook Enabled?","type":"main","index":0})

# manual trigger for CLI / test runs
mk("Manual Trigger","n8n-nodes-base.manualTrigger",1,{},[0,-200])
conn["Manual Trigger"]={"main":[L("Config")]}

wf={"id":"aifeedAutopilot1","name":"AIFeed Autopilot (8am #1 / 5pm #2 ET)","nodes":nodes,"connections":conn,"settings":{"timezone":"America/New_York","executionOrder":"v1","errorWorkflow":"aifeedErrAlert01","saveDataErrorExecution":"all"},"active":False,"pinData":{}}
json.dump(wf,open("AIFeed_Autopilot.json","w"),indent=2)
err={"id":"aifeedErrAlert01","name":"AIFeed Error Alerts","nodes":[{"id":"et","name":"Error Trigger","type":"n8n-nodes-base.errorTrigger","typeVersion":1,"position":[0,0],"parameters":{}},{"id":"tg","name":"Telegram Alert","type":"n8n-nodes-base.telegram","typeVersion":1.2,"position":[240,0],"parameters":{"chatId":"7748417469","text":"=⚠️ AIFeed Autopilot failed\nNode: {{ $json.execution.lastNodeExecuted }}\nError: {{ $json.execution.error.message }}\n{{ $json.execution.url }}","additionalFields":{"appendAttribution":False}},"credentials":{"telegramApi":{"id":"aifeedTelegram01","name":"Telegram AIFeed bot (NEW token)"}}}],"connections":{"Error Trigger":{"main":[[{"node":"Telegram Alert","type":"main","index":0}]]}},"settings":{"timezone":"America/New_York"},"active":False}
json.dump(err,open("AIFeed_Error_Alerts.json","w"),indent=2)
