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
  // Firestore 'in' supports max 10 — batch if needed
  const allDocs=[];
  for(let i=0;i<userIds.length;i+=10){
    const batch=userIds.slice(i,i+10);
    const snap=await db.collection("fcmTokens").where("userId","in",batch).get();
    snap.forEach(d=>allDocs.push(d));
  }
  // Deduplicate: only send to one token per user
  const seen=new Set();
  const tokens=[];
  allDocs.forEach(d=>{
    const uid=d.data().userId;
    if(!seen.has(uid)){seen.add(uid);tokens.push({ref:d.ref,token:d.data().token});}
  });
  const ntag=tag||("tm-"+Date.now());
  const sends=tokens.map(async(t)=>{
    try{
      await admin.messaging().send({
        token:t.token,
        notification:{title,body},
        data:{title,body,tag:ntag,link:"https://techmeld.eu"},
        webpush:{notification:{icon:"/favicon.ico",badge:"/favicon.ico",vibrate:[200,100,200],tag:ntag}},
      });
    }catch(e){
      // Clean up invalid tokens
      if(e.code==="messaging/registration-token-not-registered"||e.code==="messaging/invalid-registration-token"){
        console.log("Removing stale FCM token:",t.token.slice(0,20)+"...");
        await t.ref.delete().catch(()=>{});
      }
    }
  });
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

exports.checkTrialEligibility = onCall({region:"europe-west1"}, async(req)=>{
  const{email}=req.data;
  if(!email)throw new HttpsError("invalid-argument","E-mail is vereist");
  const emailKey=email.toLowerCase().replace(/[.#$/\[\]]/g,'_');
  const doc=await db.collection("trialHistory").doc(emailKey).get();
  if(doc.exists){
    throw new HttpsError("already-exists","Dit e-mailadres heeft al een proefperiode gehad.");
  }
  return{eligible:true};
});

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
    console.log("reCAPTCHA API response:",JSON.stringify(data));
    if(!data.tokenProperties||!data.tokenProperties.valid){
      console.warn("reCAPTCHA invalid token:",JSON.stringify(data));
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

exports.inviteUser = onCall({region:"europe-west1",secrets:["EMAIL_PASS"]}, async(req)=>{
  const{name,email,role,orgId}=req.data;
  if(!req.auth)throw new HttpsError("unauthenticated","Login vereist");
  let ur;
  try{ur=await admin.auth().createUser({email,displayName:name});}
  catch(e){if(e.code==="auth/email-already-exists")ur=await admin.auth().getUserByEmail(email);else throw new HttpsError("internal",e.message);}
  await db.collection("users").doc(ur.uid).set({name,email,role:role||"reporter",orgId,avatar:name.split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase(),createdAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
  // Send invitation email with password setup link
  try{
    const resetLink=await admin.auth().generatePasswordResetLink(email,{url:"https://techmeld.eu/app"});
    // Extract oobCode and build app link (prevents email scanner pre-fetch consuming the one-time code)
    const parsed=new URL(resetLink);
    const oobCode=parsed.searchParams.get("oobCode");
    const appLink="https://techmeld.eu?mode=resetPassword&oobCode="+encodeURIComponent(oobCode);
    const orgDoc=await db.collection("organizations").doc(orgId).get();
    const orgName=orgDoc.exists?(orgDoc.data().name||"uw organisatie"):"uw organisatie";
    const inviterDoc=await db.collection("users").doc(req.auth.uid).get();
    const inviterName=inviterDoc.exists?(inviterDoc.data().name||"Een beheerder"):"Een beheerder";
    const rl=ROLE_LABELS[role]||"Melder";
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif"><table width="100%" style="background:#f1f5f9;padding:24px 0"><tr><td align="center"><table width="540" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)"><tr><td style="background:#1e293b;padding:18px 24px"><span style="color:#60a5fa;font-size:18px;font-weight:800">Tech</span><span style="color:#fff;font-size:18px;font-weight:800">Meld</span><span style="color:#60a5fa;font-size:10px;vertical-align:super">™</span><span style="float:right;color:#94a3b8;font-size:12px">${orgName}</span></td></tr><tr><td style="background:#eff6ff;padding:8px 24px;border-bottom:2px solid #2563eb"><span style="color:#2563eb;font-weight:700;font-size:12px">👋 UITNODIGING</span><span style="float:right;color:#64748b;font-size:12px">Rol: <b>${rl}</b></span></td></tr><tr><td style="padding:24px"><h2 style="margin:0 0 8px;font-size:17px;color:#1e293b">Welkom bij TechMeld, ${name}!</h2><p style="margin:0 0 16px;color:#64748b;font-size:13px;line-height:1.6"><strong>${inviterName}</strong> heeft u uitgenodigd voor <strong>${orgName}</strong> als <strong>${rl}</strong>.</p><p style="margin:0 0 20px;color:#64748b;font-size:13px;line-height:1.6">Klik op onderstaande knop om uw wachtwoord in te stellen en direct aan de slag te gaan.</p></td></tr><tr><td style="padding:0 24px 24px" align="center"><a href="${appLink}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Wachtwoord instellen</a></td></tr><tr><td style="padding:0 24px 20px"><p style="margin:0;color:#94a3b8;font-size:11px;line-height:1.5">Werkt de knop niet? Kopieer deze link:<br><a href="${appLink}" style="color:#2563eb;word-break:break-all;font-size:10px">${appLink}</a></p></td></tr><tr><td style="background:#f8fafc;padding:12px 24px;border-top:1px solid #e2e8f0"><p style="margin:0;font-size:10px;color:#94a3b8;text-align:center">© 2026 TechMeld™ — Technisch Meldingenbeheer</p></td></tr></table></td></tr></table></body></html>`;
    await getTransporter().sendMail({from:FROM,to:email,subject:`👋 Uitnodiging: ${orgName} op TechMeld`,html});
    console.log(`✅ Invite email sent to ${email} for ${orgName}`);
  }catch(e){console.error("❌ Invite email error:",e);}
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

// ═══════════════════════════════════════════
// SUBSCRIPTION ACTIVATION (server-side only)
// ═══════════════════════════════════════════
const PLANS_SERVER = {
  starter: { name:"Starter", price:0, yearPrice:0 },
  professional: { name:"Professional", price:89, yearPrice:Math.round(89*12*0.85) },
  enterprise: { name:"Enterprise", price:159, yearPrice:Math.round(159*12*0.85) },
  groep: { name:"Groepslicentie", price:129, yearPrice:Math.round(129*12*0.85) },
};

// ═══════════════════════════════════════════
// PAYPAL ORDERS API v2
// ═══════════════════════════════════════════
const PAYPAL_BASE = "https://api-m.paypal.com";

async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("PayPal credentials not configured");
  const res = await fetch(PAYPAL_BASE + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(clientId + ":" + clientSecret).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error("PayPal auth failed: " + res.status);
  const data = await res.json();
  return data.access_token;
}

exports.createPayPalOrder = onCall({region:"europe-west1",secrets:["PAYPAL_CLIENT_ID","PAYPAL_CLIENT_SECRET"]}, async(req)=>{
  if(!req.auth) throw new HttpsError("unauthenticated","Login vereist");
  const{planId,billing}=req.data;
  if(!planId||!billing) throw new HttpsError("invalid-argument","planId en billing zijn vereist");
  const planInfo=PLANS_SERVER[planId];
  if(!planInfo) throw new HttpsError("invalid-argument","Ongeldig plan: "+planId);
  if(!["month","year"].includes(billing)) throw new HttpsError("invalid-argument","Ongeldige billing periode");
  if(planInfo.price===0) throw new HttpsError("invalid-argument","Starter plan vereist geen betaling");
  // Verify caller is admin of their org
  const userDoc=await db.collection("users").doc(req.auth.uid).get();
  if(!userDoc.exists) throw new HttpsError("not-found","Gebruiker niet gevonden");
  const userData=userDoc.data();
  if(userData.role!=="admin") throw new HttpsError("permission-denied","Alleen admins kunnen abonnementen wijzigen");
  const orgId=userData.orgId;
  if(!orgId) throw new HttpsError("failed-precondition","Geen organisatie gevonden");
  // Calculate price server-side (incl. 21% BTW)
  const basePrice=billing==="year"?planInfo.yearPrice:planInfo.price;
  const totalAmount=(basePrice*1.21).toFixed(2);
  // Create PayPal order
  const accessToken=await getPayPalAccessToken();
  const desc="TechMeld "+planInfo.name+" — "+(billing==="year"?"jaarabonnement":"maandabonnement");
  const ppRes=await fetch(PAYPAL_BASE+"/v2/checkout/orders",{
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+accessToken},
    body:JSON.stringify({
      intent:"CAPTURE",
      purchase_units:[{
        description:desc,
        amount:{currency_code:"EUR",value:totalAmount},
      }],
      payment_source:{paypal:{experience_context:{
        return_url:"https://techmeld.eu/app?paypal_status=success",
        cancel_url:"https://techmeld.eu/app?paypal_status=cancelled",
        brand_name:"TechMeld",
        user_action:"PAY_NOW",
      }}},
    }),
  });
  if(!ppRes.ok){
    const err=await ppRes.text();
    console.error("PayPal create order error:",err);
    throw new HttpsError("internal","PayPal order aanmaken mislukt");
  }
  const ppOrder=await ppRes.json();
  // Save pending order in Firestore
  await db.collection("paypalOrders").doc(ppOrder.id).set({
    orderId:ppOrder.id,
    orgId,
    uid:req.auth.uid,
    planId,
    billing,
    expectedAmount:totalAmount,
    status:"CREATED",
    createdAt:admin.firestore.FieldValue.serverTimestamp(),
  });
  // Find approval URL
  const approveLink=ppOrder.links.find(l=>l.rel==="payer-action")||ppOrder.links.find(l=>l.rel==="approve");
  if(!approveLink) throw new HttpsError("internal","PayPal approval URL niet gevonden");
  console.log(`✅ PayPal order created: ${ppOrder.id} for org ${orgId} (${planInfo.name} ${billing})`);
  return{orderId:ppOrder.id,approveUrl:approveLink.href};
});

exports.capturePayPalOrder = onCall({region:"europe-west1",secrets:["PAYPAL_CLIENT_ID","PAYPAL_CLIENT_SECRET"]}, async(req)=>{
  if(!req.auth) throw new HttpsError("unauthenticated","Login vereist");
  const{orderId}=req.data;
  if(!orderId) throw new HttpsError("invalid-argument","orderId is vereist");
  // Load pending order from Firestore
  const orderDoc=await db.collection("paypalOrders").doc(orderId).get();
  if(!orderDoc.exists) throw new HttpsError("not-found","PayPal order niet gevonden");
  const orderData=orderDoc.data();
  // Verify caller owns this order
  if(orderData.uid!==req.auth.uid) throw new HttpsError("permission-denied","Order behoort niet tot deze gebruiker");
  // Prevent double capture
  if(orderData.status==="COMPLETED") throw new HttpsError("already-exists","Deze betaling is al verwerkt");
  // Capture payment
  const accessToken=await getPayPalAccessToken();
  const capRes=await fetch(PAYPAL_BASE+"/v2/checkout/orders/"+orderId+"/capture",{
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+accessToken},
  });
  if(!capRes.ok){
    const err=await capRes.text();
    console.error("PayPal capture error:",err);
    throw new HttpsError("internal","PayPal betaling vastleggen mislukt");
  }
  const capData=await capRes.json();
  if(capData.status!=="COMPLETED"){
    await db.collection("paypalOrders").doc(orderId).update({status:capData.status});
    throw new HttpsError("failed-precondition","Betaling niet voltooid. Status: "+capData.status);
  }
  // Verify captured amount matches expected
  const capture=capData.purchase_units[0].payments.captures[0];
  const capturedAmount=capture.amount.value;
  if(capturedAmount!==orderData.expectedAmount){
    console.error(`Amount mismatch: captured ${capturedAmount} vs expected ${orderData.expectedAmount}`);
    await db.collection("paypalOrders").doc(orderId).update({status:"AMOUNT_MISMATCH",capturedAmount});
    throw new HttpsError("failed-precondition","Betaald bedrag komt niet overeen met verwacht bedrag");
  }
  // Activate subscription
  const orgId=orderData.orgId;
  const planInfo=PLANS_SERVER[orderData.planId];
  const now=new Date();
  const expiresAt=new Date(now);
  if(orderData.billing==="year"){expiresAt.setFullYear(expiresAt.getFullYear()+1)}else{expiresAt.setMonth(expiresAt.getMonth()+1)}
  await db.collection("subscriptions").doc(orgId).update({
    plan:orderData.planId,status:"active",billing:orderData.billing,
    expiresAt:admin.firestore.Timestamp.fromDate(expiresAt),
    activatedAt:admin.firestore.Timestamp.fromDate(now),
    method:"paypal",updatedAt:admin.firestore.FieldValue.serverTimestamp(),
  });
  // Create invoice with transaction ID
  const basePrice=orderData.billing==="year"?planInfo.yearPrice:planInfo.price;
  await db.collection("organizations").doc(orgId).collection("invoices").doc().set({
    plan:planInfo.name,amount:basePrice,billing:orderData.billing,method:"paypal",
    status:"betaald",date:now.toISOString(),
    paypalOrderId:orderId,paypalTransactionId:capture.id,
    createdAt:admin.firestore.FieldValue.serverTimestamp(),
  });
  // Mark PayPal order as completed
  await db.collection("paypalOrders").doc(orderId).update({
    status:"COMPLETED",capturedAt:admin.firestore.FieldValue.serverTimestamp(),
    transactionId:capture.id,
  });
  console.log(`✅ PayPal payment captured: ${orderId} → ${planInfo.name} (${orderData.billing}) for org ${orgId}`);
  return{success:true,plan:orderData.planId,status:"active",billing:orderData.billing,expiresAt:expiresAt.toISOString(),activatedAt:now.toISOString()};
});

exports.activateSubscription = onCall({region:"europe-west1"}, async(req)=>{
  if(!req.auth) throw new HttpsError("unauthenticated","Login vereist");
  const{planId,method,billing}=req.data;
  if(!planId||!method||!billing) throw new HttpsError("invalid-argument","planId, method en billing zijn vereist");
  const planInfo=PLANS_SERVER[planId];
  if(!planInfo) throw new HttpsError("invalid-argument","Ongeldig plan: "+planId);
  if(!["month","year"].includes(billing)) throw new HttpsError("invalid-argument","Ongeldige billing periode");
  if(method!=="bank") throw new HttpsError("invalid-argument","Gebruik PayPal checkout voor PayPal-betalingen");
  // Verify caller is admin of their org
  const userDoc=await db.collection("users").doc(req.auth.uid).get();
  if(!userDoc.exists) throw new HttpsError("not-found","Gebruiker niet gevonden");
  const userData=userDoc.data();
  if(userData.role!=="admin") throw new HttpsError("permission-denied","Alleen admins kunnen abonnementen wijzigen");
  const orgId=userData.orgId;
  if(!orgId) throw new HttpsError("failed-precondition","Geen organisatie gevonden");
  // Calculate expiration
  const now=new Date();
  const expiresAt=new Date(now);
  if(billing==="year"){expiresAt.setFullYear(expiresAt.getFullYear()+1)}else{expiresAt.setMonth(expiresAt.getMonth()+1)}
  // Update subscription
  await db.collection("subscriptions").doc(orgId).update({
    plan:planId, status:"active", billing,
    expiresAt:admin.firestore.Timestamp.fromDate(expiresAt),
    activatedAt:admin.firestore.Timestamp.fromDate(now),
    method, updatedAt:admin.firestore.FieldValue.serverTimestamp(),
  });
  // Create invoice
  const price=billing==="year"?planInfo.yearPrice:planInfo.price;
  await db.collection("organizations").doc(orgId).collection("invoices").doc().set({
    plan:planInfo.name, amount:price, billing, method,
    status:"betaald", date:now.toISOString(),
    createdAt:admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✅ Subscription activated: ${planInfo.name} (${billing}) for org ${orgId} via ${method}`);
  return{success:true, plan:planId, status:"active", billing, expiresAt:expiresAt.toISOString(), activatedAt:now.toISOString()};
});

// ═══════════════════════════════════════════
// SUPER ADMIN PROFILE (server-side only)
// ═══════════════════════════════════════════
const SUPER_ADMINS_SERVER = ["tigrealata@hotmail.com","info@techmeld.eu"];

exports.createSuperAdminProfile = onCall({region:"europe-west1"}, async(req)=>{
  if(!req.auth) throw new HttpsError("unauthenticated","Login vereist");
  const email=req.auth.token.email;
  if(!email||!SUPER_ADMINS_SERVER.includes(email)){
    throw new HttpsError("permission-denied","Niet geautoriseerd als super admin");
  }
  const{name}=req.data;
  if(!name) throw new HttpsError("invalid-argument","Naam is vereist");
  await db.collection("users").doc(req.auth.uid).set({
    name, email, role:"superadmin", orgId:null,
    avatar:name.split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase(),
    createdAt:admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✅ Super admin profile created: ${email}`);
  return{success:true};
});

exports.deleteOrganization = onCall({region:"europe-west1"}, async(req)=>{
  const{orgId}=req.data;
  if(!req.auth)throw new HttpsError("unauthenticated","Login vereist");
  // Delete all users in this org (Auth + Firestore)
  const usersSnap=await db.collection("users").where("orgId","==",orgId).get();
  for(const doc of usersSnap.docs){
    try{await admin.auth().deleteUser(doc.id);}catch(e){}
    await doc.ref.delete();
  }
  // Delete subcollections: meldingen, invoices
  const melSnap=await db.collection("organizations").doc(orgId).collection("meldingen").get();
  const b1=db.batch();melSnap.forEach(d=>b1.delete(d.ref));await b1.commit();
  const invSnap=await db.collection("organizations").doc(orgId).collection("invoices").get();
  const b2=db.batch();invSnap.forEach(d=>b2.delete(d.ref));await b2.commit();
  const fpSnap=await db.collection("organizations").doc(orgId).collection("floorplans").get();
  const b3=db.batch();fpSnap.forEach(d=>b3.delete(d.ref));await b3.commit();
  // Delete subscription
  try{await db.collection("subscriptions").doc(orgId).delete();}catch(e){}
  // Delete FCM tokens for org users
  const tokSnap=await db.collection("fcmTokens").where("orgId","==",orgId).get();
  const b4=db.batch();tokSnap.forEach(d=>b4.delete(d.ref));await b4.commit();
  // Delete organization document
  await db.collection("organizations").doc(orgId).delete();
  return{success:true};
});

// ═══════════════════════════════════════════
// SEND INVOICE EMAIL
// ═══════════════════════════════════════════
exports.sendInvoiceEmail = onCall({region:"europe-west1",secrets:["EMAIL_PASS"]}, async(req)=>{
  if(!req.auth) throw new HttpsError("unauthenticated","Login vereist");
  const{invoiceHtml,planName}=req.data;
  if(!invoiceHtml) throw new HttpsError("invalid-argument","invoiceHtml is vereist");
  // Verify caller is admin of their org
  const userDoc=await db.collection("users").doc(req.auth.uid).get();
  if(!userDoc.exists) throw new HttpsError("not-found","Gebruiker niet gevonden");
  const userData=userDoc.data();
  if(userData.role!=="admin") throw new HttpsError("permission-denied","Alleen admins kunnen facturen versturen");
  if(!userData.email) throw new HttpsError("failed-precondition","Geen e-mailadres gevonden");
  const subject="Factuur TechMeld"+(planName?" — "+planName:"");
  await getTransporter().sendMail({from:FROM,to:userData.email,subject,html:invoiceHtml});
  console.log(`✅ Invoice email sent to ${userData.email}`);
  return{success:true};
});
