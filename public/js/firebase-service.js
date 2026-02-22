(function(){console.log('%c© TechMeld™ — Alle rechten voorbehouden','color:#2563eb;font-size:14px;font-weight:bold');console.log('%cBeschermd door Belgisch Auteursrecht & EU-richtlijn 2009/24/EG.','color:#64748b;font-size:11px');console.log('%cOngeautoriseerd kopiëren, reverse-engineering of hergebruik is verboden.','color:#dc2626;font-size:11px')})();
if(location.hostname!=='localhost'&&!location.hostname.startsWith('127.')){const _ce=console.error;console.error=function(){const a=[...arguments].map(v=>typeof v==='string'?v.replace(/[a-zA-Z0-9]{20,}/g,'[REDACTED]'):v);_ce.apply(console,a)};}
// ═══════════════════════════════════════════
// CODE PROTECTION (deterrent)
// ═══════════════════════════════════════════
(function(){
  if(location.hostname==='localhost'||location.hostname.startsWith('127.'))return;
  // Disable right-click context menu
  document.addEventListener('contextmenu',function(e){e.preventDefault()});
  // Disable text selection on body (inputs/textareas remain selectable)
  document.addEventListener('selectstart',function(e){
    var t=e.target.tagName;if(t==='INPUT'||t==='TEXTAREA'||t==='SELECT')return;e.preventDefault();
  });
  // Block common dev tool shortcuts
  document.addEventListener('keydown',function(e){
    // F12
    if(e.key==='F12'){e.preventDefault();return}
    // Ctrl+Shift+I (DevTools), Ctrl+Shift+J (Console), Ctrl+Shift+C (Inspector)
    if((e.ctrlKey||e.metaKey)&&e.shiftKey&&['I','J','C'].includes(e.key.toUpperCase())){e.preventDefault();return}
    // Ctrl+U (View Source)
    if((e.ctrlKey||e.metaKey)&&e.key.toUpperCase()==='U'){e.preventDefault();return}
    // Ctrl+S (Save page)
    if((e.ctrlKey||e.metaKey)&&e.key.toUpperCase()==='S'){e.preventDefault();return}
  });
})();
if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('/firebase-messaging-sw.js').catch(()=>{})})}
var deferredPrompt=null;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;window.dispatchEvent(new CustomEvent('pwa-installable'))});

// ═══════════════════════════════════════════
// FIREBASE CONFIG & INITIALIZATION
// ═══════════════════════════════════════════
// ⚠️ VUL HIER JE EIGEN FIREBASE CONFIG IN
// Ga naar Firebase Console > Project Settings > General > Your apps > Config
var firebaseConfig = {
  apiKey: "AIzaSyDGgQBiHQVa8z8khvrIKp392mc_d8dDEJU",
  authDomain: "techmeld.firebaseapp.com",
  projectId: "techmeld",
  storageBucket: "techmeld.firebasestorage.app",
  messagingSenderId: "460267327070",
  appId: "1:460267327070:web:8772a5e513bf912bb22ecf",
  measurementId: "G-W17MQFNPK3"
};

// Initialize Firebase
var fb = null, auth = null, db = null, storage = null, messaging = null, functions = null;
var firebaseReady = false;
var VAPID_KEY = "BHPoEmgQs-YqKYBYlXsTWS_zAjpvJ8PBdsjowoU77STg9d5ExdDXG5-3TvVnAjQhRp_xgD40vx7XX92L3rXRxDk";
try {
  fb = firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();
  storage = firebase.storage();
  // Initialize FCM
  if('Notification' in window && firebase.messaging.isSupported()){
    messaging = firebase.messaging();
  }
  // Enable offline persistence
  db.enablePersistence({synchronizeTabs:true}).catch(()=>{});
  // Initialize Cloud Functions (europe-west1)
  functions = firebase.app().functions("europe-west1");
  firebaseReady = firebaseConfig.apiKey && firebaseConfig.apiKey !== "JOUW_API_KEY";
  if(!firebaseReady) console.warn("⚠️ Firebase config niet ingevuld — app werkt in demo-modus. Vul je Firebase config in om data op te slaan.");
} catch(e) {
  console.warn("Firebase init error:", e);
}

// ═══════════════════════════════════════════
// FIREBASE DATABASE SERVICE
// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
// PUSH NOTIFICATIONS (FCM + Browser)
// ═══════════════════════════════════════════
var PushNotify={
  supported:'Notification' in window,
  token:null,
  _userId:null,
  _orgId:null,
  knownIds:new Set(),
  get permission(){return this.supported?Notification.permission:'denied'},
  async requestPermission(){
    if(!this.supported)return false;
    var result=await Notification.requestPermission();
    return result==='granted';
  },
  async getFCMToken(){
    if(!messaging)return null;
    try{
      var reg=await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js')||await navigator.serviceWorker.ready;
      var token=await messaging.getToken({vapidKey:VAPID_KEY,serviceWorkerRegistration:reg});
      this.token=token;
      return token;
    }catch(e){console.warn('FCM token error:',e);return null}
  },
  async registerAndSave(userId,orgId){
    this._userId=userId;
    this._orgId=orgId;
    var granted=await this.requestPermission();
    if(!granted)return null;
    var token=await this.getFCMToken();
    if(token){
      await DB.saveFCMToken(userId,orgId,token);
      console.log('FCM token saved');
    }
    // Listen for token refresh
    if(messaging){
      var self=this;
      messaging.onMessage(function(payload){
        var d=payload.notification||payload.data||{};
        self.show(d.title||'TechMeld',d.body||'Nieuwe melding',d.tag||'tm-fg-'+Date.now());
      });
    }
    return token;
  },
  async refreshToken(){
    if(!this._userId||!this._orgId||this.permission!=='granted')return;
    var token=await this.getFCMToken();
    if(token){await DB.saveFCMToken(this._userId,this._orgId,token)}
  },
  show(title,body,tag){
    if(this.permission!=='granted')return;
    if(navigator.serviceWorker&&navigator.serviceWorker.controller){
      navigator.serviceWorker.ready.then(function(reg){
        reg.showNotification(title,{body:body,icon:'/favicon.ico',badge:'/favicon.ico',tag:tag||'techmeld-'+Date.now(),vibrate:[200,100,200],data:{url:'/'}});
      });
    }else{
      new Notification(title,{body:body,icon:'/favicon.ico',tag:tag||'techmeld'});
    }
  },
  initKnownIds(meldingen){
    this.knownIds=new Set(meldingen.map(function(m){return m.id}));
  },
  checkNew(meldingen,curUserId){
    var self=this;
    if(this.knownIds.size===0){this.initKnownIds(meldingen);return}
    meldingen.forEach(function(m){
      if(!self.knownIds.has(m.id)&&m.by!==curUserId){
        self.show('🔔 Nieuwe melding: '+m.title,(m.desc||'').substring(0,80),'mel-'+m.id);
      }
    });
    this.knownIds=new Set(meldingen.map(function(m){return m.id}));
  }
};

var sanitize=(obj)=>{
  if(!obj||typeof obj!=='object')return obj;
  if(obj.toDate&&typeof obj.toDate==='function')return obj.toDate().toISOString();
  if(Array.isArray(obj))return obj.map(sanitize);
  const out={};for(const k of Object.keys(obj))out[k]=sanitize(obj[k]);return out;
};
var escHtml=(s)=>s?String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"):"";
var safeUrl=(url)=>{if(!url||typeof url!=="string")return"";try{const u=new URL(url);return["https:","http:","data:"].includes(u.protocol)?url:""}catch(e){return""}};
var _FieldValue = firebase.firestore.FieldValue;
var _Timestamp = firebase.firestore.Timestamp;
var _serverTimestamp = () => _FieldValue.serverTimestamp();
var _fromDate = (d) => _Timestamp.fromDate(d);
var _call = async (name, data) => {
  if (!functions) throw new Error("Cloud Functions niet beschikbaar");
  return await functions.httpsCallable(name)(data || {});
};
var DB = {
  serverTimestamp: _serverTimestamp,
  fromDate: _fromDate,
  call: _call,
  // AUTH
  async register(email, password, name, orgName, orgType) {
    if(!firebaseReady) return {uid:"demo-"+Date.now(), email, displayName:name};
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({displayName: name});
    // Super admin — no org, no trial (profile created server-side)
    try{
      await _call('createSuperAdminProfile', {name});
      return cred.user;
    }catch(e){
      // Not a super admin — continue with normal registration
    }
    // Create organization doc
    const orgRef = db.collection('organizations').doc();
    // Seed rooms based on organization type
    const roomsByType = {
      care: [
        {id:"r1",name:"Kamer 101",fId:"f1",type:"bedroom"},
        {id:"r2",name:"Kamer 102",fId:"f1",type:"bedroom"},
        {id:"r3",name:"Gemeenschapsruimte",fId:"f2",type:"common"},
        {id:"r4",name:"Badkamer",fId:"f2",type:"bathroom"},
        {id:"r5",name:"Berging",fId:"f3",type:"storage"},
        {id:"r6",name:"Technische Ruimte",fId:"f3",type:"technical"},
      ],
      hospital: [
        {id:"r1",name:"Kamer 101",fId:"f1",type:"bedroom"},
        {id:"r2",name:"Kamer 102",fId:"f1",type:"bedroom"},
        {id:"r3",name:"Wachtzaal",fId:"f2",type:"common"},
        {id:"r4",name:"Operatiezaal",fId:"f2",type:"medical"},
        {id:"r5",name:"Berging",fId:"f3",type:"storage"},
        {id:"r6",name:"Technische Ruimte",fId:"f3",type:"technical"},
      ],
      hotel: [
        {id:"r1",name:"Kamer 101",fId:"f1",type:"bedroom"},
        {id:"r2",name:"Kamer 102",fId:"f1",type:"bedroom"},
        {id:"r3",name:"Lobby",fId:"f2",type:"common"},
        {id:"r4",name:"Restaurant",fId:"f2",type:"dining"},
        {id:"r5",name:"Berging",fId:"f3",type:"storage"},
        {id:"r6",name:"Technische Ruimte",fId:"f3",type:"technical"},
      ],
    };
    const orgData = {
      name: orgName, type: orgType,
      ownerId: cred.user.uid,
      buildings: [{id:"b1", name:"Hoofdgebouw"}],
      floors: [
        {id:"f1",name:"Begane Grond",nr:0,bId:"b1"},
        {id:"f2",name:"1e Verdieping",nr:1,bId:"b1"},
        {id:"f3",name:"2e Verdieping",nr:2,bId:"b1"},
      ],
      rooms: roomsByType[orgType] || roomsByType.care,
      createdAt: _serverTimestamp(),
    };
    await orgRef.set(orgData);
    // Create user profile doc FIRST (required by Firestore rules for isMemberOf check)
    await db.collection('users').doc(cred.user.uid).set({
      name, email, role:"admin", orgId: orgRef.id,
      avatar: name.split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase(),
      createdAt: _serverTimestamp(),
    });
    // Create seed meldingen (user profile must exist before this for security rules)
    const meldingenRef = db.collection('organizations').doc(orgRef.id).collection('meldingen');
    const now = new Date();
    await Promise.all([
      meldingenRef.add({
        title:"Lekkende kraan — Kamer 101", desc:"Kraan in kamer 101 lekt continu.",
        status:"open", prio:"medium", cat:"Sanitair",
        room:"r1", floor:"f1", building:"b1",
        by: cred.user.uid, to: null,
        createdAt: _fromDate(now),
      }),
      meldingenRef.add({
        title:"Verlichting flikkert", desc:"Verlichting in de gang flikkert onregelmatig.",
        status:"in_progress", prio:"high", cat:"Elektriciteit",
        room:"r3", floor:"f2", building:"b1",
        by: cred.user.uid, to: null,
        createdAt: _fromDate(new Date(now.getTime() - 86400000)),
      }),
      meldingenRef.add({
        title:"Deur sluit niet goed", desc:"Deur van berging sluit niet goed meer.",
        status:"resolved", prio:"low", cat:"Deur/Raam",
        room:"r5", floor:"f3", building:"b1",
        by: cred.user.uid, to: null,
        createdAt: _fromDate(new Date(now.getTime() - 172800000)),
      }),
    ]);
    // Create subscription — Starter 14-day trial
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14);
    await db.collection('subscriptions').doc(orgRef.id).set({
      plan:"starter", status:"trial",
      trialEnd: _fromDate(trialEnd),
      orgId: orgRef.id,
      createdAt: _serverTimestamp(),
    });
    // Save trial history for anti-abuse
    const emailKey = email.toLowerCase().replace(/[.#$/\[\]]/g,'_');
    await db.collection('trialHistory').doc(emailKey).set({
      email: email.toLowerCase(),
      orgName: orgName,
      orgId: orgRef.id,
      registeredAt: _serverTimestamp(),
      expireAt: _fromDate(new Date(Date.now()+365*24*60*60*1000))
    });
    return cred.user;
  },

  async login(email, password) {
    if(!firebaseReady) return {uid:"demo-"+Date.now(), email, displayName:"Demo"};
    const cred = await auth.signInWithEmailAndPassword(email, password);
    return cred.user;
  },

  async logout() {
    if(!firebaseReady) return;
    try{
      const u=auth.currentUser;
      if(u){const ts=await db.collection('fcmTokens').where('userId','==',u.uid).get();ts.forEach(function(d){d.ref.delete()})}
    }catch(e){}
    await auth.signOut();
  },

  async saveFCMToken(userId,orgId,token){
    if(!firebaseReady||!token)return;
    var id=userId+"_"+btoa(token).slice(0,8);
    await db.collection('fcmTokens').doc(id).set({userId:userId,orgId:orgId,token:token,device:/Mobi|Android/i.test(navigator.userAgent)?"mobile":"desktop",updatedAt:_serverTimestamp()},{merge:true});
  },

  async getOrgFCMTokens(orgId,excludeUserId){
    if(!firebaseReady)return[];
    var snap=await db.collection('fcmTokens').where('orgId','==',orgId).get();
    return snap.docs.map(function(d){return d.data()}).filter(function(t){return t.userId!==excludeUserId});
  },

  // MELDINGEN
  async addMelding(orgId, melding) {
    if(!firebaseReady) return melding;
    const ref = db.collection('organizations').doc(orgId).collection('meldingen').doc();
    const data = {...melding, id: ref.id, createdAt: _serverTimestamp(), updatedAt: _serverTimestamp()};
    await ref.set(data);
    return {...melding, id: ref.id};
  },

  async updateMelding(orgId, melding) {
    if(!firebaseReady) return;
    await db.collection('organizations').doc(orgId).collection('meldingen').doc(melding.id).update({
      ...melding, updatedAt: _serverTimestamp()
    });
  },

  async deleteMelding(orgId, meldingId) {
    if(!firebaseReady) return;
    await db.collection('organizations').doc(orgId).collection('meldingen').doc(meldingId).delete();
  },

  // ORGANIZATION
  async updateOrg(orgId, data) {
    if(!firebaseReady) return;
    await db.collection('organizations').doc(orgId).update(data);
  },

  // USERS
  async addUser(orgId, userData) {
    if(!firebaseReady) return userData;
    const ref = db.collection('users').doc();
    await ref.set({...userData, orgId, createdAt: _serverTimestamp()});
    return {...userData, id: ref.id};
  },

  async updateUser(userId, data) {
    if(!firebaseReady) return;
    await db.collection('users').doc(userId).update(data);
  },

  async deleteUser(userId) {
    if(!firebaseReady) return;
    await db.collection('users').doc(userId).delete();
  },

  // SUBSCRIPTION
  async updateSubscription(orgId, data) {
    if(!firebaseReady) return;
    await db.collection('subscriptions').doc(orgId).update({
      ...data, updatedAt: _serverTimestamp()
    });
  },

  // INVOICES
  async addInvoice(orgId, invoice) {
    if(!firebaseReady) return invoice;
    const ref = db.collection('organizations').doc(orgId).collection('invoices').doc();
    await ref.set({...invoice, createdAt: _serverTimestamp()});
    return {...invoice, id: ref.id};
  },

  // REAL-TIME LISTENERS
  listenMeldingen(orgId, callback) {
    if(!firebaseReady) return ()=>{};
    return db.collection('organizations').doc(orgId).collection('meldingen')
      .orderBy('createdAt','desc')
      .onSnapshot(snap => {
        const meldingen = snap.docs.map(d => sanitize({id:d.id, ...d.data()}));
        callback(meldingen);
      });
  },

  listenUsers(orgId, callback) {
    if(!firebaseReady) return ()=>{};
    return db.collection('users').where('orgId','==',orgId)
      .onSnapshot(snap => {
        const users = snap.docs.map(d => sanitize({id:d.id, ...d.data()}));
        callback(users);
      });
  },

  listenOrg(orgId, callback) {
    if(!firebaseReady) return ()=>{};
    return db.collection('organizations').doc(orgId)
      .onSnapshot(doc => {
        if(doc.exists) callback(sanitize({id:doc.id, ...doc.data()}));
      });
  },

  listenSubscription(orgId, callback) {
    if(!firebaseReady) return ()=>{};
    return db.collection('subscriptions').doc(orgId)
      .onSnapshot(doc => {
        if(doc.exists) callback(sanitize(doc.data()));
      });
  },

  // Get user profile
  async getUserProfile(uid) {
    if(!firebaseReady) return null;
    const doc = await db.collection('users').doc(uid).get();
    return doc.exists ? sanitize({id:doc.id, ...doc.data()}) : null;
  },

  // GROEPSLICENTIE
  async getGroepLocaties(groepId) {
    if(!firebaseReady) return [];
    const snap = await db.collection('organizations').where('groepId','==',groepId).get();
    return snap.docs.map(d => sanitize({id:d.id, ...d.data()}));
  },
  async getLocatieMeldingen(orgId) {
    if(!firebaseReady) return [];
    const snap = await db.collection('organizations').doc(orgId).collection('meldingen').orderBy('createdAt','desc').get();
    return snap.docs.map(d => sanitize({id:d.id, ...d.data()}));
  },
  async getLocatieUsers(orgId) {
    if(!firebaseReady) return [];
    const snap = await db.collection('users').where('orgId','==',orgId).get();
    return snap.docs.map(d => sanitize({id:d.id, ...d.data()}));
  },
  async addLocatie(groepId, name, type) {
    if(!firebaseReady) return null;
    const ref = db.collection('organizations').doc();
    await ref.set({
      name, type: type||"care", groepId,
      buildings:[{id:"b1",name:"Hoofdgebouw"}],
      floors:[{id:"f1",name:"Begane Grond",nr:0,bId:"b1"}],
      rooms:[],
      createdAt: _serverTimestamp(),
    });
    return {id:ref.id, name, type, groepId};
  },
  async setGroepId(orgId, groepId) {
    if(!firebaseReady) return;
    await db.collection('organizations').doc(orgId).update({groepId});
  },
};