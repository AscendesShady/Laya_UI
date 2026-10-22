import { mkdir, writeFile } from 'node:fs/promises';
import { buildRequest, MODELS } from '../server.mjs';
import { validResult } from '../public/session.js';

const base = 'http://127.0.0.1:11434';
const folder = 'verification/model-comparison-20';
const bool = (id,title,state,question,yes,no,expected,reason) => ({id,title,type:'bool',state,question,trueDescription:yes,falseDescription:no,expected,reason});
const choose = (id,title,state,question,options,expected,reason,type='choice') => ({id,title,type,state,question,options:options.map(([label,description])=>({label,description})),expected,reason});
const scale = (id,title,state,question,options,expected,reason) => choose(id,title,state,question,options,expected,reason,'score');
const teams = [['Billing','Payments, invoices, duplicate charges and refunds'],['Technical','Software errors, crashes and service outages'],['Sales','New purchases, pricing and demonstrations'],['Other','Requests not covered by these teams']];
const tones = [['Positive','Mostly satisfied or appreciative'],['Neutral','Neither satisfied nor dissatisfied'],['Negative','Mostly dissatisfied or critical']];
const urgency = [['Low','No deadline and no service impact; routine backlog work'],['Medium','A deadline within the next week, but no outage or immediate blocker'],['High','An active outage or a blocker that needs action today']];
// Expected answers and reasons are fixed here before any model is called.
const cases = [
  bool(1,'Cancellation threat','I was charged twice. Refund the duplicate today or I will cancel my subscription.','Does the customer threaten to cancel the subscription?','The customer threatens to cancel.','The customer does not threaten to cancel.',true,'The customer explicitly says they will cancel.'),
  bool(2,'No cancellation threat','I was charged twice. Please refund the duplicate. I am happy with the service and will keep my subscription.','Does the customer threaten to cancel the subscription?','The customer threatens to cancel.','The customer does not threaten to cancel.',false,'They explicitly say they will keep the subscription.'),
  bool(3,'Phishing indicators','An email claims to be from my bank. It links to http://bank-login-check.example and asks for my password and full card PIN to avoid suspension in one hour.','Does this email show signs of phishing?','The message uses deceptive urgency or requests credentials through a suspicious link.','The message is legitimate correspondence without suspicious credential collection.',true,'A suspicious link, urgency, and a password/PIN request are explicit.'),
  bool(4,'Ordinary meeting email','From my known coworker: The design review is at 2 pm in meeting room B. Please bring the printed sketches. The email contains no links, attachments, password requests or payment requests.','Does this email show signs of phishing?','The message uses deceptive urgency or requests credentials through a suspicious link.','The message is legitimate correspondence without suspicious credential collection.',false,'The provided facts describe routine internal correspondence.'),
  bool(5,'Refund policy: eligible','Policy: A full refund is allowed only when an item is unopened and the return is within 30 days of delivery. Case: The item was delivered 12 days ago and its packaging is unopened.','Does this case qualify for a full refund under the supplied policy?','The item is unopened and the return is within 30 days.','At least one refund condition is not satisfied.',true,'Both necessary conditions are satisfied.'),
  bool(6,'Refund policy: too late','Policy: A full refund is allowed only when an item is unopened and the return is within 30 days of delivery. Case: The item was delivered 45 days ago and its packaging is unopened.','Does this case qualify for a full refund under the supplied policy?','The item is unopened and the return is within 30 days.','At least one refund condition is not satisfied.',false,'45 days exceeds the 30-day limit.'),
  choose(7,'Route a duplicate charge','My subscription payment was collected twice yesterday. Please refund the duplicate charge.','Which team should handle this request?',teams,'Billing','The problem is payment and refund handling.'),
  choose(8,'Route an app crash','The app crashes every time I open Settings. Restarting and reinstalling did not fix the crash.','Which team should handle this request?',teams,'Technical','The problem is a reproducible software crash.'),
  choose(9,'Positive review','The delivery was quick, everything works perfectly, and the support team was wonderful. I am delighted with this purchase.','What is the overall sentiment of the review?',tones,'Positive','The review expresses satisfaction throughout.'),
  choose(10,'Negative review','The item broke on the first day. Support ignored three messages. This was a terrible purchase and I regret buying it.','What is the overall sentiment of the review?',tones,'Negative','The review expresses dissatisfaction throughout.'),
  choose(11,'Invoice policy mismatch','Policy: Approve an invoice only when its purchase-order number and amount both match the purchase order. Hold mismatches for manual review. Reject only confirmed duplicates. Case: The amount matches, the purchase-order number does not match, and this invoice is not a duplicate.','What should accounts payable do under this policy?',[['Approve','Both purchase-order number and amount match'],['Hold','A mismatch needs manual review'],['Reject','The invoice is a confirmed duplicate']],'Hold','The purchase-order mismatch triggers hold, not approval or duplicate rejection.'),
  choose(12,'Agent tool selection','The user asks: Find every PDF in the local project folder whose filename contains bridge. No web research or calendar changes are needed.','Which tool category should the agent use?',[['Files','Search files and directories on local storage'],['Browser','Search or open websites'],['Calendar','Read or update calendar events'],['Calculator','Perform arithmetic']],'Files','The task explicitly searches local filenames.'),
  choose(13,'Rank warranty actions','A customer received a broken item and provided photos. Warranty covers the damage. The customer explicitly wants a working replacement rather than a refund, and stock is available.','Which action best addresses this request?',[['Replace','Ship a covered warranty replacement'],['Refund','Refund the payment instead of replacing'],['Repair advice','Ask the customer to attempt repairs'],['Reject','Deny the warranty request']],'Replace','A replacement is requested, covered, and available. Only the top rank is graded.','ranking'),
  choose(14,'Rank security responses','A security alert confirms that an attacker is actively using a stolen session token. Policy: Immediately revoke confirmed compromised sessions, then investigate.','Which action should be performed first under the stated policy?',[['Revoke','Invalidate the compromised session immediately'],['Investigate only','Investigate while leaving the compromised session active'],['Ignore','Take no action'],['Marketing','Send a promotional email']],'Revoke','The explicit first action in policy is session revocation. Only the top rank is graded.','ranking'),
  choose(15,'Rank offline storage choices','Requirements: Notes must work with the internet disconnected and must never leave the device. Synchronization to another device is not required.','Which design best satisfies these requirements?',[['Local storage','Keep notes on this device and support offline use'],['Cloud-only','Require a remote cloud API for every read and write'],['Public website','Publish every note on a public website'],['Email notes','Email every note to an external mailbox']],'Local storage','It alone directly meets both offline and device-local requirements. Only the top rank is graded.','ranking'),
  choose(16,'Rank traffic detours','A bus must get to the terminal now. Route A is closed to all traffic. Route B is open, permits buses, and reaches the terminal. Route C is open but cannot reach the terminal.','Which route is the best valid route to the terminal?',[['Route A','Use the road closed to all traffic'],['Route B','Use the open bus-permitted road that reaches the terminal'],['Route C','Use the road that does not reach the terminal']],'Route B','Route B is the only route satisfying all stated constraints. Only the top rank is graded.','ranking'),
  scale(17,'Score active payment outage','Production checkout is currently down. No customer can complete payment. Orders are blocked and the incident needs action today.','Rate the request urgency using the supplied scale.',urgency,2,'An active service outage is explicitly High (index 2).'),
  scale(18,'Score routine cosmetic work','Please change a decorative icon in the settings page sometime in the backlog. There is no deadline, no broken functionality, and no impact on service.','Rate the request urgency using the supplied scale.',urgency,0,'There is explicitly no deadline or service impact: Low (index 0).'),
  scale(19,'Score a nonblocking deadline','Please send the monthly usage report three days from now. Everything is working normally, and nobody is blocked today.','Rate the request urgency using the supplied scale.',urgency,1,'A deadline within a week without an outage is Medium (index 1).'),
  scale(20,'Score purchase readiness','The prospect is the decision-maker, has approved budget, and asks to sign the purchase order this week.','Rate this lead using the supplied readiness scale.',[['Cold','No budget, no buying authority, and no near-term purchase plan'],['Warm','Some interest but budget or buying authority is still unconfirmed'],['Hot','Budget and buying authority are confirmed and purchase is planned this week']],2,'All explicit Hot criteria are present (index 2).'),
];
await mkdir(folder,{recursive:true});
await writeFile(`${folder}/cases.json`,JSON.stringify(cases,null,2));
const tags = await (await fetch(`${base}/api/tags`)).json();
const version = await (await fetch(`${base}/api/version`)).json();
const models = await Promise.all(MODELS.map(async name => ({...(tags.models.find(m=>m.name===name)),show:await(await fetch(`${base}/api/show`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:name})})).json()})));
const rows=[],warmups=[];
async function infer(c,model) {
  const input={...c,model}, request=buildRequest(input), started=performance.now();
  const response=await fetch(`${base}/v1/systemone`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(120000)});
  const result=await response.json(),elapsed_ms=performance.now()-started;
  if (!response.ok) throw new Error(JSON.stringify(result));
  if (!validResult({...result,elapsed_ms},input)) throw new Error(`Invalid result: ${model}, case ${c.id}`);
  return {request,result,elapsed_ms};
}
for(const model of MODELS) warmups.push({model,...await infer(cases[0],model)});
for(let repetition=0;repetition<3;repetition++) {
  for(const c of cases) {
    const order=(c.id+repetition)%2 ? MODELS : [...MODELS].reverse();
    for(const model of order) rows.push({caseId:c.id,model,repetition,...await infer(c,model)});
  }
  console.log(`Completed repetition ${repetition+1}: ${rows.length} matched model calls.`);
}
function decision(c,answer) {
  if(c.type==='bool') return Math.abs(answer.noul-.5)<1e-9 ? 'tie' : answer.noul>.5;
  if(c.type==='score') return Number(Object.entries(answer.probabilities).sort((a,b)=>b[1]-a[1])[0][0]);
  return answer.choice;
}
function expectedProbability(c,answer) {
  return c.type==='bool' ? c.expected?answer.noul:1-answer.noul : answer.probabilities[String(c.expected)];
}
const median=values=>{const s=[...values].sort((a,b)=>a-b);return s.length%2?s[Math.floor(s.length/2)]:(s[s.length/2-1]+s[s.length/2])/2;};
const comparisons=cases.map(c=>({id:c.id,title:c.title,type:c.type,expected:c.expected,models:Object.fromEntries(MODELS.map(model=>{
  const runs=rows.filter(r=>r.model===model&&r.caseId===c.id),answer=runs[0].result.answers.decision,prediction=decision(c,answer);
  return [model,{prediction,correct:prediction===c.expected,expectedProbability:expectedProbability(c,answer),answer,elapsed_ms:runs.map(r=>r.elapsed_ms),stable:runs.every(r=>decision(c,r.result.answers.decision)===prediction)}];
}))}));
const summary=Object.fromEntries(MODELS.map(model=>{
  const m=comparisons.map(c=>({c,...c.models[model]}));
  const scores=m.filter(r=>r.c.type==='score');
  return [model,{correct:m.filter(r=>r.correct).length,total:m.length,byType:Object.fromEntries(['bool','choice','ranking','score'].map(type=>[type,{correct:m.filter(r=>r.c.type===type&&r.correct).length,total:m.filter(r=>r.c.type===type).length}])),scoreMAE:scores.reduce((sum,r)=>sum+Math.abs(r.answer.score-r.c.expected),0)/scores.length,
    warmMedianMs:median(rows.filter(r=>r.model===model&&r.repetition>0).map(r=>r.elapsed_ms)),warmTimingCalls:40,stableCases:m.filter(r=>r.stable).length}];
}));
const output={testedAt:new Date().toISOString(),ollamaVersion:version.version,models,cases,warmups,rows,comparisons,summary,
  disagreements:comparisons.filter(c=>c.models[MODELS[0]].prediction!==c.models[MODELS[1]].prediction).map(c=>c.id),
  methodology:{uniqueCases:20,repetitions:3,scoredRepetition:0,warmTimingRepetitions:[1,2],rankingGrading:'Top alternative only, not the full permutation.',scoreGrading:'Argmax level for matches; expected-value MAE reported separately.',limit:'Small hand-authored demonstration set, not an independent benchmark or calibration study.'}};
await writeFile(`${folder}/results.json`,JSON.stringify(output,null,2));
console.log(JSON.stringify({summary,disagreements:output.disagreements,comparisons},null,2));
