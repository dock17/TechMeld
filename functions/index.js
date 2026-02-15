const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();
const db = admin.firestore();

const EMAIL_USER = "info@techmeld.eu";

function getTransporter() {
  return nodemailer.createTransport({
    host: "smtp-auth.mailprotect.be",
    port: 587,
    secure: false,
    auth: { user: EMAIL_USER, pass: process.env.EMAIL_PASS },
    tls: { rejectUnauthorized: false },
  });
}
const FROM = `TechMeld <${EMAIL_USER}>`;
const PRIO = { critical:{l:"Kritiek",c:"#dc2626",b:"#fef2f2"}, high:{l:"Hoog",c:"#ea580c",b:"#fff7ed"}, medium:{l:"Normaal",c:"#2563eb",b:"#eff6ff"}, low:{l:"Laag",c:"#16a34a",b:"#f0fdf4"} };
const STL = { open:"Open", in_progress:"In Behandeling", resolved:"Opgelost", closed:"Gesloten" };

function buildEmail(type, mel, org, reporter, assigned, comment) {
  const p = PRIO[mel.prio] || PRIO.medium;
  const st = STL[mel.status] || "Open";
  const rooms = org.rooms||[], floors = org.floors||[], buildings = org.buildings||[];
  const room = rooms.find(r=>r.id===mel.rId), floor = floors.find(f=>f.id===mel.fId);
  const building = buildings.find(b=>b.id===(mel.bId||(floor&&floor.bId)));
  const loc = [building?.name,floor?.name,room?.name].filter(Boolean).join(" · ");
  const subject = type==="new"?`🔧 Nieuwe melding: ${mel.title}`:type==="status"?`📋 ${mel.title} → ${st}`:type==="assigned"?`👤 Toegewezen: ${mel.title}`:`💬 Reactie: ${mel.title}`;
  const action = type==="new"?`Nieuwe melding${reporter?" van "+reporter:""}.`:type==="status"?`Status gewijzigd naar <strong>${st}</strong>.`:type==="assigned"?`Aan u toegewezen.`:`Nieuwe reactie.`;
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif"><table width="100%" style="background:#f1f5f9;padding:24px 0"><tr><td align="center"><table width="540" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)"><tr><td style="background:#1e293b;padding:18px 24px"><span style="color:#60a5fa;font-size:18px;font-weight:800">Tech</span><span style="color:#fff;font-size:18px;font-weight:800">Meld</span><span style="color:#60a5fa;font-size:10px;vertical-align:super">™</span><span style="float:right;color:#94a3b8;font-size:12px">${org.name||""}</span></td></tr><tr><td style="background:${p.b};padding:8px 24px;border-bottom:2px solid ${p.c}"><span style="color:${p.c};font-weight:700;font-size:12px">● ${p.l.toUpperCase()}</span><span style="float:right;color:#64748b;font-size:12px">Status: <b>${st}</b></span></td></tr><tr><td style="padding:20px 24px"><h2 style="margin:0 0 8px;font-size:17px;color:#1e293b">${mel.title}</h2><p style="margin:0 0 14px;color:#64748b;font-size:13px">${action}</p>${mel.desc&&type==="new"?`<div style="background:#f8fafc;border-radius:8px;padding:10px 14px;margin-bottom:14px;border-left:3px solid #cbd5e1"><p style="margin:0;color:#475569;font-size:12px">${mel.desc}</p></div>`:""}${comment?`<div style="background:#eff6ff;border-radius:8px;padding:10px 14px;margin-bottom:14px;border-left:3px solid #2563eb"><p style="margin:0;color:#1e293b;font-size:12px">💬 ${comment}</p></div>`:""}${loc?`<p style="font-size:12px;color:#94a3b8">📍 ${loc}</p>`:""}${reporter?`<p style="font-size:12px;color:#94a3b8">👤 ${reporter}</p>`:""}${assigned?`<p style="font-size:12px;color:#94a3b8">🔧 ${assigned}</p>`:""}</td></tr><tr><td style="padding:0 24px 20px" align="center"><a href="https://techmeld.eu" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">Bekijk in TechMeld</a></td></tr><tr><td style="background:#f8fafc;padding:12px 24px;border-top:1px solid #e2e8f0"><p style="margin:0;font-size:10px;color:#94a3b8;text-align:center">© 2026 TechMeld™</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, html };
}

async function getUsers(orgId) { const s=await db.collection("users").where("orgId","==",orgId).get(); return s.docs.map(d=>({id:d.id,...d.data()})); }

async function sendFCM(userIds, title, body, tag) {
  if(!userIds.length)return;
  const snap=await db.collection("fcmTokens").where("userId","in",userIds.slice(0,10)).get();
  // Deduplicate: only send to one token per user
  const seen=new Set();
  const tokens=[];
  snap.forEach(d=>{
    const uid=d.data().userId;
    if(!seen.has(uid)){seen.add(uid);tokens.push(d.data().token);}
  });
  const ntag=tag||("tm-"+Date.now());
  const sends=tokens.map(t=>admin.messaging().send({token:t,data:{title,body,tag:ntag,link:"https://techmeld.eu"}}).catch(()=>{}));
  if(sends.length)await Promise.all(sends);
}

exports.onNewMelding = onDocumentCreated({document:"organizations/{orgId}/meldingen/{meldingId}",region:"europe-west1",secrets:["EMAIL_PASS"]}, async(event)=>{
  const mel=event.data.data(), orgId=event.params.orgId;
  try{
    const users=await getUsers(orgId);
    const orgDoc=await db.collection("organizations").doc(orgId).get();
    const org=orgDoc.exists?orgDoc.data():{};
    const rep=users.find(u=>u.id===mel.by);
    let to=[],an=null;
    if(mel.to){const a=users.find(u=>u.id===mel.to);if(a?.email){to.push(a.email);an=a.name;}}
    else{to=users.filter(u=>(u.role==="technician"||u.role==="admin")&&u.email&&u.id!==mel.by).map(u=>u.email);}
    if(!to.length)return;
    const{subject,html}=buildEmail("new",mel,org,rep?.name,an);
    await Promise.all(to.map(t=>getTransporter().sendMail({from:FROM,to:t,subject,html})));
    // Send FCM push to assigned user or all technicians/admins
    const pushIds=mel.to?[mel.to]:users.filter(u=>(u.role==="technician"||u.role==="admin")&&u.id!==mel.by).map(u=>u.id);
    await sendFCM(pushIds,"🔧 Nieuwe melding",mel.title+(rep?" - van "+rep.name:""));
    console.log(`✅ Email+Push verstuurd: ${mel.title} → ${to.length} ontvanger(s)`);
  }catch(e){console.error("❌",e);}
});

exports.onMeldingUpdate = onDocumentUpdated({document:"organizations/{orgId}/meldingen/{meldingId}",region:"europe-west1",secrets:["EMAIL_PASS"]}, async(event)=>{
  const before=event.data.before.data(), after=event.data.after.data(), orgId=event.params.orgId;
  const sc=before.status!==after.status, ac=before.to!==after.to&&after.to, nc=(after.comments||[]).length>(before.comments||[]).length;
  if(!sc&&!ac&&!nc)return;
  try{
    const users=await getUsers(orgId);
    const orgDoc=await db.collection("organizations").doc(orgId).get();
    const org=orgDoc.exists?orgDoc.data():{};
    const rep=users.find(u=>u.id===after.by), asgn=users.find(u=>u.id===after.to);
    const r=new Set();let type="status",comment=null;
    if(sc){if(rep?.email)r.add(rep.email);type="status";}
    if(ac&&!sc){if(asgn?.email)r.add(asgn.email);type="assigned";}
    if(nc){if(rep?.email)r.add(rep.email);if(asgn?.email)r.add(asgn.email);type="comment";const c=after.comments||[];comment=c[c.length-1]?.text;const cm=users.find(u=>u.id===c[c.length-1]?.uId);if(cm?.email)r.delete(cm.email);}
    if(!r.size)return;
    const{subject,html}=buildEmail(type,after,org,rep?.name,asgn?.name,comment);
    await Promise.all([...r].map(t=>getTransporter().sendMail({from:FROM,to:t,subject,html})));
    // Send FCM push to relevant users
    const pushIds=[];
    if(ac&&asgn)pushIds.push(asgn.id);
    if(sc&&rep)pushIds.push(rep.id);
    if(nc){if(rep)pushIds.push(rep.id);if(asgn)pushIds.push(asgn.id);const c=after.comments||[];const cmId=c[c.length-1]?.uId;const idx=pushIds.indexOf(cmId);if(idx>=0)pushIds.splice(idx,1);}
    const uniqueIds=[...new Set(pushIds)];
    const pushTitle=type==="assigned"?"👤 Toegewezen":type==="status"?"📋 Status gewijzigd":type==="comment"?"💬 Nieuwe reactie":"📋 Update";
    const pushBody=after.title+(type==="status"?" → "+(STL[after.status]||""):type==="comment"&&comment?" - "+comment.slice(0,80):"");
    if(uniqueIds.length)await sendFCM(uniqueIds,pushTitle,pushBody);
    console.log(`✅ ${type} email+push: ${after.title} → ${r.size} ontvanger(s)`);
  }catch(e){console.error("❌",e);}
});

const RECAPTCHA_SITE_KEY="6LcmgWwsAAAAAML-J6-qC5iQDCmbfUnt09vnUOe0";
const RECAPTCHA_API_KEY="AIzaSyDGgQBiHQVa8z8khvrIKp392mc_d8dDEJU";

exports.verifyRecaptcha = onCall({region:"europe-west1"}, async(req)=>{
  const{token,action}=req.data;
  if(!token)throw new HttpsError("invalid-argument","Token mancante");
  try{
    const res=await fetch(`https://recaptchaenterprise.googleapis.com/v1/projects/techmeld/assessments?key=${RECAPTCHA_API_KEY}`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({event:{token,expectedAction:action||"REGISTER",siteKey:RECAPTCHA_SITE_KEY}})
    });
    const data=await res.json();
    if(!data.tokenProperties||!data.tokenProperties.valid){
      console.warn("reCAPTCHA invalid token:",data.tokenProperties?.invalidReason);
      throw new HttpsError("permission-denied","reCAPTCHA verificatie mislukt");
    }
    if(action&&data.tokenProperties.action!==action){
      console.warn("reCAPTCHA action mismatch:",data.tokenProperties.action,"vs",action);
      throw new HttpsError("permission-denied","reCAPTCHA verificatie mislukt");
    }
    const score=data.riskAnalysis?.score??0;
    if(score<0.3){
      console.warn("reCAPTCHA low score:",score);
      throw new HttpsError("permission-denied","reCAPTCHA verificatie mislukt — verdacht verkeer");
    }
    console.log(`✅ reCAPTCHA OK: score=${score}, action=${action}`);
    return{success:true,score};
  }catch(e){
    if(e instanceof HttpsError)throw e;
    console.error("reCAPTCHA error:",e);
    throw new HttpsError("internal","reCAPTCHA verificatie fout");
  }
});

exports.inviteUser = onCall({region:"europe-west1"}, async(req)=>{
  const{name,email,role,orgId}=req.data;
  if(!req.auth)throw new HttpsError("unauthenticated","Login vereist");
  let ur;
  try{ur=await admin.auth().createUser({email,displayName:name});}
  catch(e){if(e.code==="auth/email-already-exists")ur=await admin.auth().getUserByEmail(email);else throw new HttpsError("internal",e.message);}
  await db.collection("users").doc(ur.uid).set({name,email,role:role||"reporter",orgId,avatar:name.split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase(),createdAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
  return{uid:ur.uid,email};
});

const ROLE_LABELS={admin:"Beheerder",technician:"Technicus",reporter:"Melder"};

exports.updateUserRole = onCall({region:"europe-west1"}, async(req)=>{
  const{userId,role,perms}=req.data;
  if(!req.auth)throw new HttpsError("unauthenticated","Login vereist");
  if(!userId||!role)throw new HttpsError("invalid-argument","userId en role zijn vereist");
  const allowed=["admin","technician","reporter"];
  if(!allowed.includes(role))throw new HttpsError("invalid-argument","Ongeldig rol");
  await db.collection("users").doc(userId).update({role,perms:perms||[]});
  return{success:true};
});

exports.deleteUserAccount = onCall({region:"europe-west1"}, async(req)=>{
  const{userId}=req.data;
  if(!req.auth)throw new HttpsError("unauthenticated","Login vereist");
  try{await admin.auth().deleteUser(userId);}catch(e){}
  try{await db.collection("users").doc(userId).delete();}catch(e){}
  const t=await db.collection("fcmTokens").where("userId","==",userId).get();
  const b=db.batch();t.forEach(d=>b.delete(d.ref));await b.commit();
  return{success:true};
});
