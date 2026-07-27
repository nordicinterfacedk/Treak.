/* ============================================================
   TREAK — Supabase-backed application logic
   Real accounts, real Postgres data, real-time chat.
   ============================================================ */

// Guards against script.js accidentally running twice on the same
// page (e.g. a duplicate <script> tag, or a live-reload tool
// re-injecting it) — which previously crashed the whole page with
// "Identifier already declared" and silently broke every button.
if(window.__TREAK_SCRIPT_LOADED__){
  console.warn('Treak: script.js tried to run a second time on this page — skipping. Check index.html for a duplicate <script src="script.js"> tag.');
} else {
window.__TREAK_SCRIPT_LOADED__ = true;

// ------------------------------------------------------------
// 1. SUPABASE CLIENT
// ------------------------------------------------------------
const SUPABASE_URL = 'https://qkhnzwngamyhswtktrhw.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_2yM-MOIfIDVpWtf6KLJgHA_MC5bheC3';

let supabase = null;
try{
  if(!window.supabase) throw new Error('Supabase library script did not load (check your internet connection, or that the CDN <script> tag runs before script.js).');
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}catch(err){
  console.error('Treak: Supabase failed to initialize —', err.message);
}

const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const modeIcon = { walk:"🚶", bike:"🚴", transit:"🚌" };
const initials = name => (name||'?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
function daysAgo(ts){
  const d = Math.floor((Date.now() - new Date(ts).getTime())/86400000);
  return d<=0 ? 'today' : d===1 ? '1 day ago' : `${d} days ago`;
}
/* Real verified badge (used to be a plain ✔ character) */
const VERIFIED_BADGE = `<svg width="14" height="14" viewBox="0 0 22 22" style="vertical-align:-2px;flex-shrink:0;"><path d="M11 1l2.4 1.4 2.7-.4 1.3 2.4 2.4 1.3-.4 2.7L21 11l-1.4 2.4.4 2.7-2.4 1.3-1.3 2.4-2.7-.4L11 21l-2.4-1.4-2.7.4-1.3-2.4-2.4-1.3.4-2.7L1 11l1.4-2.4-.4-2.7 2.4-1.3 1.3-2.4 2.7.4L11 1z" fill="#4F46E5"/><path d="M7.5 11.2l2.2 2.2 4.8-5.2" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
/* Renders a company/teen's avatar box — a real uploaded photo if they
   have one, otherwise falls back to the colored initials box. Used
   everywhere a logo/avatar appears so uploads show up consistently. */
function logoBoxHTML(entity, sizePx, className){
  className = className || 'company-logo';
  const style = sizePx ? `width:${sizePx}px;height:${sizePx}px;font-size:${Math.round(sizePx*0.4)}px;` : '';
  if(entity && entity.logo_url){
    return `<div class="${className}" style="${style}background:var(--card-raised);"><img src="${entity.logo_url}" alt=""></div>`;
  }
  const bg = entity?.color || 'var(--gradient)';
  const label = entity?.short || initials(entity?.name || '?');
  return `<div class="${className}" style="${style}background:${bg}">${label}</div>`;
}
function logSupabaseError(context, error){
  if(error) console.error(`Treak / Supabase [${context}]:`, error.message || error);
}
/* Shows a persistent on-page banner instead of just failing silently,
   so a connection problem is obvious instead of looking like a broken page. */
function showConnectionBanner(message){
  if(document.getElementById('treakConnBanner')) return;
  const bar = document.createElement('div');
  bar.id = 'treakConnBanner';
  bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#F04438;color:#fff;text-align:center;padding:10px 16px;font:600 13px Inter,sans-serif;';
  bar.textContent = `⚠️ ${message}`;
  document.body.prepend(bar);
}
if(!supabase) showConnectionBanner("Could not connect to the database. The page will still work, but login, signup and job data won't load until this is fixed — check the browser console (F12) for details.");

// ------------------------------------------------------------
// 2. SESSION / CURRENT PROFILE
// ------------------------------------------------------------
let currentProfile = null;

async function refreshCurrentProfile(){
  if(!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if(!session){ currentProfile = null; return null; }
  const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
  if(error){ logSupabaseError('refreshCurrentProfile', error); currentProfile = null; return null; }
  const isTimedOut = data.banned_until && new Date(data.banned_until) > new Date();
  if(data.banned || isTimedOut){
    await supabase.auth.signOut();
    currentProfile = null;
    if(data.banned){
      pushToast('🚫','Account suspended', data.ban_reason || 'Contact support for details');
    } else {
      pushToast('⏱️','Account timed out', `${data.ban_reason ? data.ban_reason+' — ' : ''}until ${new Date(data.banned_until).toLocaleDateString()}`);
    }
    return null;
  }
  currentProfile = data;
  return data;
}
function currentUser(){ return currentProfile; }

if(supabase){
  supabase.auth.onAuthStateChange(async ()=>{
    await refreshCurrentProfile();
    updateAccountUI();
  });
}

// ------------------------------------------------------------
// 3. VIEW SWITCHING
// ------------------------------------------------------------
let lastView = 'landing';
async function showView(name){
  lastView = name;
  $$('.view').forEach(v=>v.classList.remove('active'));
  const target = document.getElementById('view-'+name);
  if(target) target.classList.add('active');
  window.scrollTo({top:0, behavior:'auto'});
  await rerenderCurrentView();
}
async function rerenderCurrentView(){
  updateAccountUI();
  if(lastView === 'landing'){ await renderCompanies(); await renderJobs(); }
  if(lastView === 'dashboard') await renderTeenDashboard();
  if(lastView === 'company') await renderCompanyDashboard();
  if(lastView === 'admin') await renderAdmin();
}
$$('[data-nav]').forEach(el=>{
  el.addEventListener('click', async e=>{
    e.preventDefault();
    const dest = el.dataset.nav;
    if(dest === 'dashboard' || dest === 'company' || dest === 'admin'){
      const user = currentUser();
      if(!user){ openAuth(); return; }
      const roleView = user.role === 'teen' ? 'dashboard' : user.role === 'company' ? 'company' : 'admin';
      await showView(roleView);
      return;
    }
    await showView(dest);
  });
});

// ------------------------------------------------------------
// 4. NAV / ACCOUNT MENU
// ------------------------------------------------------------
function updateAccountUI(){
  const user = currentUser();
  const loggedIn = !!user;
  $('#loginBtn').classList.toggle('hidden', loggedIn);
  $('#signupBtn').classList.toggle('hidden', loggedIn);
  $('#accountMenu').classList.toggle('hidden', !loggedIn);
  if(loggedIn){
    $('#accountName').textContent = (user.name||'You').split(' ')[0];
    $('#accountAvatar').innerHTML = user.logo_url ? `<img src="${user.logo_url}" alt="">` : initials(user.name);
  }
}
$('#accountBtn').addEventListener('click', e=>{ e.stopPropagation(); $('#accountDropdown').classList.toggle('open'); });
document.addEventListener('click', e=>{ if(!e.target.closest('.account-menu')) $('#accountDropdown').classList.remove('open'); });
$('#accountDashLink').addEventListener('click', async ()=>{
  const user = currentUser(); if(!user) return;
  await showView(user.role === 'teen' ? 'dashboard' : user.role === 'company' ? 'company' : 'admin');
  $('#accountDropdown').classList.remove('open');
});
$('#logoutBtn').addEventListener('click', async ()=>{
  await supabase.auth.signOut();
  currentProfile = null;
  updateAccountUI();
  await showView('landing');
  pushToast('👋','Logged out', 'See you again soon');
});

// ------------------------------------------------------------
// 5. PUBLIC: companies + jobs
// ------------------------------------------------------------
function companyCardHTML(c, openJobsCount){
  return `
  <div class="company-card" data-view-company-public="${c.id}">
    <div class="company-card-top">
      ${logoBoxHTML(c)}
      <div>
        <div class="company-name">${c.name} ${c.verified ? `<span class="verified-tick" title="Verified employer">${VERIFIED_BADGE}</span>`:''}</div>
        <div class="company-meta">${c.category||''} · ${c.distance||1} km away</div>
      </div>
    </div>
    <div class="company-stats">
      <span>${openJobsCount>0 ? '<b style="color:var(--green)">● Hiring</b>' : '<span class="muted">Not hiring</span>'}</span>
      <span><b>${openJobsCount}</b> open jobs</span>
    </div>
  </div>`;
}
async function renderCompanies(){
  const { data: companies, error } = await supabase.from('profiles').select('*').eq('role','company').eq('approved', true);
  logSupabaseError('renderCompanies', error);
  const { data: liveJobsList } = await supabase.from('jobs').select('company_id').eq('status','approved');
  const counts = {};
  (liveJobsList||[]).forEach(j=> counts[j.company_id] = (counts[j.company_id]||0)+1);
  // A company only shows up publicly once it actually has a live job —
  // being an approved account alone isn't "hiring."
  const list = (companies||[]).filter(c => counts[c.id] > 0);
  if(!list.length){
    $('#companiesGrid').innerHTML = `<p class="jobs-empty" style="grid-column:1/-1;">No companies with live jobs yet — <button type="button" class="link-btn" id="beFirstCompanyBtn">be the first to sign up</button>.</p>`;
    $('#logoStrip').innerHTML = `<span class="muted" style="font-size:14px;">Your company could be first</span>`;
    const beFirstBtn = $('#beFirstCompanyBtn');
    if(beFirstBtn) beFirstBtn.addEventListener('click', ()=>{ authRole='company'; authMode='signup'; refreshAuthUI(); openAuth(); });
    return;
  }
  $('#companiesGrid').innerHTML = list.slice(0,8).map(c=> companyCardHTML(c, counts[c.id]||0)).join('');
  $('#logoStrip').innerHTML = list.map(c=>`<span>${c.name}</span>`).join('');
  $$('[data-view-company-public]').forEach(card=> card.addEventListener('click', ()=> openCompanyProfileModal(card.dataset.viewCompanyPublic)));
}

let visibleCount = 9;
const filterState = { search:'', mode:'all', radius:20 };
let cachedLiveJobs = [];

async function fetchLiveJobs(){
  const { data, error } = await supabase
    .from('jobs')
    .select('*, company:profiles!jobs_company_id_fkey(*)')
    .eq('status','approved')
    .order('created_at', { ascending:false });
  logSupabaseError('fetchLiveJobs', error);
  return (data||[]).filter(j => j.company && j.company.approved);
}
function jobMatches(job){
  const text = (job.title + ' ' + (job.company?.name||'')).toLowerCase();
  if(filterState.search && !text.includes(filterState.search.toLowerCase())) return false;
  if(filterState.mode !== 'all' && job.mode !== filterState.mode) return false;
  if(job.distance > filterState.radius) return false;
  return true;
}
let mySavedJobIds = new Set();
function jobCardHTML(job){
  const c = job.company;
  if(!c) return '';
  const isSaved = mySavedJobIds.has(job.id);
  return `
  <div class="job-card" data-job="${job.id}">
    <div class="job-card-top">
      <div class="job-card-company">
        ${logoBoxHTML(c)}
        <div><div class="job-card-company-name">${c.name}</div></div>
      </div>
      <button class="save-btn ${isSaved?'saved':''}" data-save="${job.id}" aria-label="Save job">${isSaved ? '★' : '☆'}</button>
    </div>
    <div>
      <div class="job-card-title">${job.title}</div>
      <div class="job-card-tags">
        <span class="tag">${modeIcon[job.mode]} ${job.distance} km</span>
        <span class="tag">${job.type}</span>
        <span class="tag">Age ${job.age_req}+</span>
      </div>
    </div>
    <div class="job-card-bottom">
      <span class="job-card-wage">${job.wage} kr/hr</span>
      <button class="job-card-apply" data-apply="${job.id}">Apply</button>
    </div>
  </div>`;
}
async function renderJobs(){
  cachedLiveJobs = await fetchLiveJobs();
  const grid = $('#jobsGrid');
  const filtered = cachedLiveJobs.filter(jobMatches);
  if(currentUser()?.role === 'teen') await refreshSavedJobIds();
  grid.innerHTML = filtered.length ? filtered.slice(0, visibleCount).map(jobCardHTML).join('')
    : '';
  $('#jobsEmpty').classList.toggle('hidden', filtered.length !== 0);
  if(filtered.length === 0) $('#jobsEmpty').textContent = cachedLiveJobs.length ? 'No jobs match your filters — try widening your radius.' : 'No live jobs yet — this fills up as companies get approved and post listings.';
  $('#loadMoreBtn').classList.toggle('hidden', visibleCount >= filtered.length);
  attachJobCardEvents();
}
async function refreshSavedJobIds(){
  const user = currentUser(); if(!user || user.role!=='teen') return;
  const { data } = await supabase.from('saved_jobs').select('job_id').eq('teen_id', user.id);
  mySavedJobIds = new Set((data||[]).map(r=>r.job_id));
}
function attachJobCardEvents(){
  $$('.hot-job-row').forEach(row=>{
    row.addEventListener('click', e=>{ if(e.target.closest('[data-apply]')) return; openJobModal(row.dataset.job); });
  });
  $$('.job-card').forEach(card=>{
    card.addEventListener('click', e=>{
      if(e.target.closest('[data-save]') || e.target.closest('[data-apply]')) return;
      openJobModal(card.dataset.job);
    });
  });
  $$('[data-save]').forEach(btn=>{
    btn.addEventListener('click', async e=>{
      e.stopPropagation();
      const user = currentUser();
      if(!user || user.role !== 'teen'){ openAuth(); return; }
      const jobId = btn.dataset.save;
      if(mySavedJobIds.has(jobId)){
        await supabase.from('saved_jobs').delete().eq('teen_id', user.id).eq('job_id', jobId);
        mySavedJobIds.delete(jobId);
      } else {
        const { error } = await supabase.from('saved_jobs').insert({ teen_id:user.id, job_id:jobId });
        logSupabaseError('save job', error);
        mySavedJobIds.add(jobId);
        pushToast('🔖','Job saved','Find it under Saved jobs');
      }
      await rerenderCurrentView();
    });
  });
  $$('[data-apply]').forEach(btn=>{
    btn.addEventListener('click', async e=>{ e.stopPropagation(); await applyToJob(btn.dataset.apply); });
  });
}
async function applyToJob(jobId){
  if(!supabase){ pushToast('🚫','No connection','Cannot reach the database right now'); return; }
  const user = currentUser();
  if(!user || user.role !== 'teen'){ pushToast('🔒','Log in to apply','Create a free teen account first'); openAuth(); return; }
  const job = cachedLiveJobs.find(j=>j.id===jobId) || (await supabase.from('jobs').select('*, company:profiles!jobs_company_id_fkey(*)').eq('id', jobId).single()).data;
  if(!job) return;
  const { error } = await supabase.from('applications').insert({ job_id:jobId, teen_id:user.id, company_id:job.company_id, status:'applied' });
  if(error){
    if(error.code === '23505'){ pushToast('ℹ️','Already applied', `You've already applied to this job`); }
    else { logSupabaseError('applyToJob', error); pushToast('🚫','Something went wrong','Please try again'); }
    return;
  }
  pushToast('📨','Application sent!', `${job.title} at ${job.company.name}`);
  await rerenderCurrentView();
}

$('#jobSearch').addEventListener('input', e=>{ filterState.search=e.target.value; visibleCount=9; renderJobs(); });
$$('#modeFilters .pill').forEach(pill=>{
  pill.addEventListener('click', ()=>{
    $$('#modeFilters .pill').forEach(p=>p.classList.remove('active'));
    pill.classList.add('active'); filterState.mode = pill.dataset.mode; visibleCount=9; renderJobs();
  });
});
$('#radiusSlider').addEventListener('input', e=>{
  filterState.radius = Number(e.target.value); $('#radiusValue').textContent = e.target.value; visibleCount=9; renderJobs();
});
$('#loadMoreBtn').addEventListener('click', ()=>{ visibleCount += 9; renderJobs(); });

// ------------------------------------------------------------
// 6. JOB DETAIL MODAL
// ------------------------------------------------------------
async function openCompanyProfileModal(companyId){
  const { data: c, error } = await supabase.from('profiles').select('*').eq('id', companyId).single();
  logSupabaseError('openCompanyProfileModal', error);
  if(!c) return;
  const { data: jobsList } = await supabase.from('jobs').select('*').eq('company_id', companyId).eq('status','approved');
  const jobs = jobsList || [];
  $('#jobModalContent').innerHTML = `
    <div class="jm-head">${logoBoxHTML(c, 56)}</div>
    <h2 class="jm-title">${c.name}</h2>
    <p class="jm-company">${c.category||''}${c.distance?` · ${c.distance} km away`:''}</p>
    <div class="jm-badges">
      ${c.verified ? `<span class="badge badge-verified">${VERIFIED_BADGE} Verified employer</span>` : ''}
      ${c.featured ? '<span class="badge badge-featured">★ Featured employer</span>' : ''}
    </div>
    ${c.bio ? `<div class="jm-section"><h4>About ${c.name}</h4><p>${c.bio}</p></div>` : `<div class="jm-section"><p class="muted">This company hasn't added a description yet.</p></div>`}
    <div class="jm-section">
      <h4>Open jobs (${jobs.length})</h4>
      ${jobs.length ? `<div style="display:flex;flex-direction:column;gap:10px;margin-top:8px;">${jobs.map(j=>`
        <div class="app-row" data-open-job="${j.id}" style="cursor:pointer;">
          <div class="app-row-left"><div><div class="app-row-title">${j.title}</div><div class="app-row-sub">${j.wage} kr/hr · ${j.type}</div></div></div>
          <span class="job-card-wage">${j.wage} kr/hr</span>
        </div>`).join('')}</div>` : `<p class="muted">No open jobs right now.</p>`}
    </div>
  `;
  $('#jobModalOverlay').classList.add('open');
  $$('#jobModalContent [data-open-job]').forEach(row=> row.addEventListener('click', ()=> openJobModal(row.dataset.openJob)));
}

async function openJobModal(jobId){
  const job = cachedLiveJobs.find(j=>j.id===jobId) || (await supabase.from('jobs').select('*, company:profiles!jobs_company_id_fkey(*)').eq('id', jobId).single()).data;
  if(!job) return;
  const c = job.company;
  const user = currentUser();
  // Count this as a real view — but not when the job's own company (or
  // an admin reviewing it) opens it, since that would inflate the stats
  // with the company checking their own listing rather than real interest.
  if(!user || (user.role!=='company' && user.role!=='admin')){
    supabase.rpc('increment_job_views', { job_id: jobId }).then(({error})=> logSupabaseError('increment_job_views', error));
  }
  const isSaved = mySavedJobIds.has(job.id);
  let alreadyApplied = false;
  if(user && user.role==='teen'){
    const { data } = await supabase.from('applications').select('id').eq('job_id', job.id).eq('teen_id', user.id).maybeSingle();
    alreadyApplied = !!data;
  }
  $('#jobModalContent').innerHTML = `
    <div class="jm-head">${logoBoxHTML(c, 48)}</div>
    <h2 class="jm-title">${job.title}</h2>
    <p class="jm-company"><button type="button" class="link-btn" id="jmViewCompanyBtn" style="font-size:14px;color:var(--text-mid);">${c.name}</button> · ${job.location||''}</p>
    <div class="jm-badges">
      ${c.verified ? `<span class="badge badge-verified">${VERIFIED_BADGE} Verified employer</span>` : ''}
      ${c.featured ? '<span class="badge badge-featured">★ Featured employer</span>' : ''}
      <span class="badge badge-live">${modeIcon[job.mode]} ${job.distance} km away</span>
    </div>
    <div class="jm-grid">
      <div class="jm-stat"><label>Hourly wage</label><p style="color:var(--amber)">${job.wage} kr/hr</p></div>
      <div class="jm-stat"><label>Job type</label><p>${job.type}</p></div>
      <div class="jm-stat"><label>Working hours</label><p>${job.hours||'—'}</p></div>
      <div class="jm-stat"><label>Age requirement</label><p>${job.age_req}+</p></div>
    </div>
    <div class="jm-section"><h4>About this role</h4><p>${job.description||''}</p></div>
    <div class="jm-section"><h4>Requirements</h4><ul>${(job.requirements||[]).map(r=>`<li>✓ ${r}</li>`).join('')}</ul></div>
    <div class="jm-actions">
      <button class="btn btn-secondary" id="jmSaveBtn">${isSaved ? '★ Saved' : '☆ Save'}</button>
      <button class="btn btn-primary" id="jmApplyBtn" ${alreadyApplied?'disabled':''}>${alreadyApplied ? 'Applied ✓' : 'Apply now'}</button>
    </div>`;
  $('#jobModalOverlay').classList.add('open');
  $('#jmViewCompanyBtn').addEventListener('click', ()=> openCompanyProfileModal(c.id));
  $('#jmApplyBtn').addEventListener('click', async ()=>{ if(!alreadyApplied){ await applyToJob(job.id); closeModal('jobModalOverlay'); } });
  $('#jmSaveBtn').addEventListener('click', async ()=>{
    const u = currentUser();
    if(!u || u.role!=='teen'){ openAuth(); return; }
    if(mySavedJobIds.has(job.id)){ await supabase.from('saved_jobs').delete().eq('teen_id',u.id).eq('job_id',job.id); mySavedJobIds.delete(job.id); }
    else { await supabase.from('saved_jobs').insert({ teen_id:u.id, job_id:job.id }); mySavedJobIds.add(job.id); }
    await rerenderCurrentView();
    openJobModal(job.id);
  });
}
function closeModal(id){ document.getElementById(id).classList.remove('open'); }
$('#jobModalClose').addEventListener('click', ()=>closeModal('jobModalOverlay'));
$('#jobModalOverlay').addEventListener('click', e=>{ if(e.target.id==='jobModalOverlay') closeModal('jobModalOverlay'); });

// ------------------------------------------------------------
// 7. AUTH — login / signup
// ------------------------------------------------------------
let authRole = 'teen';
let authMode = 'login';

function openAuth(){ $('#authModalOverlay').classList.add('open'); }
$('#loginBtn').addEventListener('click', ()=>{ authMode='login'; refreshAuthUI(); openAuth(); });
$('#signupBtn').addEventListener('click', ()=>{ authMode='signup'; refreshAuthUI(); openAuth(); });
$('#heroGetStarted').addEventListener('click', ()=>{ authRole='teen'; authMode='signup'; refreshAuthUI(); openAuth(); });
$('#ctaGetStarted').addEventListener('click', ()=>{ authRole='teen'; authMode='signup'; refreshAuthUI(); openAuth(); });
$('#ctaCompany').addEventListener('click', ()=>{ authRole='company'; authMode='signup'; refreshAuthUI(); openAuth(); });
$('#authModalClose').addEventListener('click', ()=>closeModal('authModalOverlay'));
$('#authModalOverlay').addEventListener('click', e=>{ if(e.target.id==='authModalOverlay') closeModal('authModalOverlay'); });

$$('.auth-tab').forEach(tab=> tab.addEventListener('click', ()=>{ authRole = tab.dataset.authtab; refreshAuthUI(); }));
$('#authToggleBtn').addEventListener('click', ()=>{ authMode = authMode==='login' ? 'signup' : 'login'; refreshAuthUI(); });

function refreshAuthUI(){
  $$('.auth-tab').forEach(t=>t.classList.toggle('active', t.dataset.authtab===authRole));
  $('#authSignupFields').classList.toggle('hidden', authMode!=='signup');
  $('#teenNameField').classList.toggle('hidden', authRole!=='teen');
  $('#teenExtraFields').classList.toggle('hidden', authRole!=='teen');
  $('#companyNameField').classList.toggle('hidden', authRole!=='company');
  $('#companyCategoryField').classList.toggle('hidden', authRole!=='company');
  $('#authTitle').textContent = authMode==='login' ? 'Welcome back' : (authRole==='teen' ? 'Create your teen account' : 'Create your company account');
  $('#authSub').textContent = authMode==='login' ? 'Log in to your account.' : (authRole==='teen' ? "Takes under two minutes." : 'Your account is reviewed by an admin before you can post live jobs.');
  $('#authSubmitBtn').textContent = authMode==='login' ? 'Log in' : 'Create account';
  $('#authToggleText').textContent = authMode==='login' ? "Don't have an account?" : 'Already have an account?';
  $('#authToggleBtn').textContent = authMode==='login' ? 'Sign up' : 'Log in';
  $('#authCheckEmailMsg').classList.add('hidden');
  $('#authForm').classList.remove('hidden');
}
refreshAuthUI();

$('#authForm').addEventListener('submit', async e=>{
  e.preventDefault();
  if(!supabase){ pushToast('🚫','No connection','Cannot reach the database right now — check the console'); return; }
  const email = $('#authEmail').value.trim().toLowerCase();
  const password = $('#authPassword').value;
  if(!email || !password) return;
  const submitBtn = $('#authSubmitBtn');
  submitBtn.disabled = true;

  if(authMode === 'login'){
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    submitBtn.disabled = false;
    if(error){ pushToast('🚫','Login failed', error.message); return; }
    await refreshCurrentProfile();
    logInRoute();
    return;
  }

  // signup
  const metadata = authRole === 'teen'
    ? { role:'teen', name: $('#authName').value.trim() || 'New Teen', age: $('#authAge').value, city: $('#authCity').value.trim() || 'Copenhagen' }
    : { role:'company', name: $('#authCompanyName').value.trim() || 'New Company', category: $('#authCategory').value, short: initials($('#authCompanyName').value.trim()||'NC'), color:'linear-gradient(135deg,#4F46E5,#7C3AED)' };

  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: metadata } });
  submitBtn.disabled = false;
  if(error){ pushToast('🚫','Sign up failed', error.message); return; }

  if(data.session){
    await refreshCurrentProfile();
    logInRoute();
    pushToast('🎉','Account created', authRole==='teen' ? 'Welcome to Treak!' : "We'll email you once an admin approves your account");
  } else {
    $('#authForm').classList.add('hidden');
    $('#authCheckEmailMsg').classList.remove('hidden');
  }
});
function logInRoute(){
  const user = currentUser();
  closeModal('authModalOverlay');
  updateAccountUI();
  if(!user) return;
  if(user.role === 'teen'){ showView('dashboard'); pushToast('👋', `Welcome back, ${user.name.split(' ')[0]}`, ''); }
  else if(user.role === 'company'){ showView('company'); pushToast('👋','Welcome back', `${user.name} dashboard loaded`); }
  else { showView('admin'); pushToast('🛡️','Admin mode', 'Review pending companies and jobs'); }
}

// ------------------------------------------------------------
// ------------------------------------------------------------
// 7b. SHARED: profile photo upload (used by both teen + company profile forms)
// ------------------------------------------------------------
async function uploadProfilePhoto(file){
  const user = currentUser();
  if(!user || !file) return null;
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `${user.id}/photo-${Date.now()}.${ext}`;
  const { error: uploadErr } = await supabase.storage.from('logos').upload(path, file, { upsert:true });
  if(uploadErr){ logSupabaseError('uploadProfilePhoto', uploadErr); pushToast('🚫','Upload failed', uploadErr.message); return null; }
  const { data } = supabase.storage.from('logos').getPublicUrl(path);
  return data?.publicUrl || null;
}

async function renderWarningsBanner(){
  const existing = document.getElementById('userWarningsBanner');
  if(existing) existing.remove();
  const user = currentUser(); if(!user) return;
  const { data: warningsList } = await supabase.from('warnings').select('*').eq('profile_id', user.id).order('created_at', {ascending:false});
  if(!warningsList || !warningsList.length) return;
  const banner = document.createElement('div');
  banner.id = 'userWarningsBanner';
  banner.className = 'warning-banner';
  banner.innerHTML = `<span style="font-size:20px;">⚠️</span><div><strong>You have ${warningsList.length} warning${warningsList.length>1?'s':''} from the Treak team</strong><ul>${warningsList.slice(0,3).map(w=>`<li>${w.message} — ${daysAgo(w.created_at)}</li>`).join('')}</ul></div>`;
  const mount = document.querySelector('.view.active .dash-main');
  if(mount) mount.prepend(banner);
}

// ------------------------------------------------------------
// 8. TEEN DASHBOARD
// ------------------------------------------------------------
function statusBadge(status){
  const map = { applied:['status-pending','Applied — awaiting response'], accepted:['status-accepted','Accepted — chat open'], rejected:['status-rejected','Not selected'] };
  return map[status] || ['status-pending', status];
}
async function renderTeenDashboard(){
  const user = currentUser();
  if(!user || user.role!=='teen'){ showView('landing'); return; }
  await refreshSavedJobIds();

  $('#dashGreeting').textContent = `Good to see you, ${user.name.split(' ')[0]}.`;
  $('#dashAvatar').innerHTML = user.logo_url ? `<img src="${user.logo_url}" alt="">` : initials(user.name);

  // My profile panel
  $('#tpName').value = user.name || '';
  $('#tpAge').value = user.age || '';
  $('#tpCity').value = user.city || '';
  $('#tpBio').value = user.bio || '';
  $('#tpPhotoPreview').innerHTML = user.logo_url ? `<img src="${user.logo_url}" alt="">` : initials(user.name);

  const { data: myApps, error } = await supabase
    .from('applications')
    .select('*, job:jobs(*), company:profiles!applications_company_id_fkey(*)')
    .eq('teen_id', user.id)
    .order('created_at', { ascending:false });
  logSupabaseError('teen applications', error);
  const apps = myApps || [];

  const pendingCount = apps.filter(a=>a.status==='applied').length;
  $('.dash-subgreeting').textContent = pendingCount
    ? `You have ${pendingCount} application${pendingCount>1?'s':''} awaiting a response.`
    : `Browse the jobs below to send your first application.`;

  const appliedIds = new Set(apps.map(a=>a.job_id));
  const recommended = cachedLiveJobs.length ? cachedLiveJobs.filter(j=>!appliedIds.has(j.id)).slice(0,3) : (await fetchLiveJobs()).filter(j=>!appliedIds.has(j.id)).slice(0,3);
  $('#dashRecommended').innerHTML = recommended.length ? recommended.map(jobCardHTML).join('') : `<p class="jobs-empty">No new recommendations right now — check back soon.</p>`;

  $('#dashApplications').innerHTML = apps.length ? apps.map(a=>{
    if(!a.job || !a.company) return '';
    const [cls,label] = statusBadge(a.status);
    return `<div class="app-row">
      <div class="app-row-left">
        ${logoBoxHTML(a.company)}
        <div><div class="app-row-title">${a.job.title}</div><div class="app-row-sub">${a.company.name} · Applied ${daysAgo(a.created_at)}</div></div>
      </div>
      <span class="status-badge ${cls}">${label}</span>
    </div>`;
  }).join('') : `<p class="jobs-empty">You haven't applied to any jobs yet.</p>`;

  const accepted = apps.filter(a=>a.status==='accepted');
  $('#dashInterviews').innerHTML = accepted.length ? accepted.map(a=>`
    <div class="interview-row" data-open-chat="${a.company.id}">
      <div class="app-row-left">
        ${logoBoxHTML(a.company)}
        <div><div class="app-row-title">${a.job.title}</div><div class="app-row-sub">${a.company.name}</div></div>
      </div>
      <span class="status-badge status-accepted">💬 Open chat</span>
    </div>`).join('') : `<p class="jobs-empty">No active conversations yet.</p>`;
  $$('[data-open-chat]').forEach(row=> row.addEventListener('click', async ()=>{ await openTeenChatWith(row.dataset.openChat); document.getElementById('teenMessagesSection').scrollIntoView({behavior:'smooth'}); }));

  const filled = [user.name, user.age, user.city].filter(Boolean).length;
  const pct = Math.round((filled/3)*80) + 20;
  $('#profilePercentLabel').textContent = pct+'%';
  requestAnimationFrame(()=>{ $('#profileProgressFill').style.width = pct+'%'; });

  $('#teenStatApplications').textContent = apps.length;
  $('#teenStatApplications').dataset.count = apps.length;
  $('#teenStatAccepted').textContent = accepted.length;
  $('#teenStatAccepted').dataset.count = accepted.length;
  $('#teenStatPending').textContent = pendingCount;
  $('#teenStatPending').dataset.count = pendingCount;
  $('#teenStatSaved').textContent = mySavedJobIds.size;
  $('#teenStatSaved').dataset.count = mySavedJobIds.size;
  observeCounters();

  attachJobCardEvents();
  await renderTeenChatList();
  await renderHotJobs();
  await renderWarningsBanner();
}

$('#teenProfileForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const user = currentUser(); if(!user) return;
  const { error } = await supabase.from('profiles').update({
    name: $('#tpName').value.trim(),
    age: Number($('#tpAge').value) || null,
    city: $('#tpCity').value.trim(),
    bio: $('#tpBio').value.trim(),
  }).eq('id', user.id);
  if(error){ logSupabaseError('save teen profile', error); pushToast('🚫','Could not save', error.message); return; }
  await refreshCurrentProfile();
  pushToast('✅','Profile updated', '');
  await renderTeenDashboard();
});
$('#tpPhotoInput').addEventListener('change', async e=>{
  const file = e.target.files[0]; if(!file) return;
  pushToast('⏳','Uploading photo…', '');
  const url = await uploadProfilePhoto(file);
  if(!url) return;
  const { error } = await supabase.from('profiles').update({ logo_url:url }).eq('id', currentUser().id);
  if(error){ logSupabaseError('save teen photo', error); pushToast('🚫','Could not save photo', error.message); return; }
  await refreshCurrentProfile();
  pushToast('✅','Photo updated', '');
  await renderTeenDashboard();
});

// ------------------------------------------------------------
// 9. COMPANY DASHBOARD
// ------------------------------------------------------------
async function renderCompanyDashboard(){
  const user = currentUser();
  if(!user || user.role!=='company'){ showView('landing'); return; }

  $('#companyGreeting').textContent = `Welcome back, ${user.name}`;
  $('#companyPendingBanner').classList.toggle('hidden', !!user.approved);
  $('#postJobBtn').disabled = !user.approved;
  $('#postJobBtn').title = user.approved ? '' : 'Your account must be approved before you can post jobs';

  // Company profile panel
  $('#cpName').value = user.name || '';
  $('#cpCategory').value = user.category || 'Retail';
  $('#cpBio').value = user.bio || '';
  $('#cpLogoPreview').innerHTML = user.logo_url ? `<img src="${user.logo_url}" alt="">` : (user.short || initials(user.name));
  $('#cpLogoPreview').style.background = user.logo_url ? 'var(--card-raised)' : (user.color || 'var(--gradient)');

  const { data: myJobs } = await supabase.from('jobs').select('*').eq('company_id', user.id).order('created_at', {ascending:false});
  const jobs = myJobs || [];
  const { data: myApps } = await supabase
    .from('applications')
    .select('*, job:jobs(*), teen:profiles!applications_teen_id_fkey(*)')
    .eq('company_id', user.id)
    .order('created_at', { ascending:false });
  const apps = myApps || [];

  $('#companySubgreeting').textContent = `${jobs.filter(j=>j.status==='approved').length} live listings · ${apps.length} total applicants`;

  const today = new Date().toDateString();
  $('#coStatApplicants').textContent = apps.length;
  $('#coStatApplicants').dataset.count = apps.length;
  $('#coStatOpenPositions').textContent = jobs.filter(j=>j.status==='approved').length;
  $('#coStatOpenPositions').dataset.count = jobs.filter(j=>j.status==='approved').length;
  $('#coStatAccepted').textContent = apps.filter(a=>a.status==='accepted').length;
  $('#coStatAccepted').dataset.count = apps.filter(a=>a.status==='accepted').length;
  $('#coStatNewToday').textContent = apps.filter(a=> new Date(a.created_at).toDateString()===today).length;
  $('#coStatNewToday').dataset.count = apps.filter(a=> new Date(a.created_at).toDateString()===today).length;
  observeCounters();

  const statLabels = { applied:['status-pending','Applied'], accepted:['status-accepted','Accepted'], rejected:['status-rejected','Rejected'] };
  $('#applicantTable').innerHTML = apps.length ? apps.slice(0,10).map(a=>{
    if(!a.teen || !a.job) return '';
    const [cls,label] = statLabels[a.status] || ['status-pending', a.status];
    const actions = a.status==='applied'
      ? `<button data-accept="${a.id}">Accept</button><button data-reject="${a.id}">Reject</button>`
      : a.status==='accepted'
        ? `<button data-chat="${a.teen.id}">Message</button>`
        : `<span class="muted" style="font-size:12px;">Closed</span>`;
    return `<div class="applicant-row">
      ${logoBoxHTML(a.teen, null, "applicant-avatar")}
      <div class="applicant-info">
        <div class="applicant-name">${a.teen.name}${a.teen.age?`, ${a.teen.age}`:''}</div>
        <div class="applicant-job">${a.job.title} · Applied ${daysAgo(a.created_at)}</div>
      </div>
      <span class="status-badge ${cls}">${label}</span>
      <div class="applicant-actions">${actions}</div>
    </div>`;
  }).join('') : `<p class="jobs-empty">No applicants yet — post a job to start receiving applications.</p>`;

  $$('[data-accept]').forEach(btn=> btn.addEventListener('click', ()=> respondToApplication(btn.dataset.accept, 'accepted')));
  $$('[data-reject]').forEach(btn=> btn.addEventListener('click', ()=> respondToApplication(btn.dataset.reject, 'rejected')));
  $$('#applicantTable [data-chat]').forEach(btn=> btn.addEventListener('click', async ()=>{ await openCompanyChatWith(btn.dataset.chat); document.getElementById('companyMessagesSection').scrollIntoView({behavior:'smooth'}); }));

  const activity = apps.slice(0,5).map(a=>{
    const verb = a.status==='accepted' ? 'You accepted' : a.status==='rejected' ? 'You passed on' : 'New application from';
    return `<div class="activity-row"><span class="activity-dot"></span><div><div class="activity-text">${verb} ${a.teen?.name||'a teen'} for ${a.job?.title||'a role'}</div><div class="activity-time">${daysAgo(a.created_at)}</div></div></div>`;
  }).join('');
  $('#activityList').innerHTML = activity || `<p class="jobs-empty">No activity yet.</p>`;

  $('#companyListings').innerHTML = jobs.length ? jobs.map(j=> companyJobCardHTML(j, apps.filter(a=>a.job_id===j.id).length)).join('') : `<p class="jobs-empty">You haven't posted any jobs yet.</p>`;
  $$('[data-manage-job]').forEach(card=> card.addEventListener('click', ()=> openCompanyJobModal(card.dataset.manageJob)));

  await renderCompanyChatList();
  await renderWarningsBanner();
}
function companyJobCardHTML(job, applicantCount){
  const statusMap = { pending:['status-pending','Pending review'], approved:['status-approved','Live'], rejected:['status-rejected','Rejected'] };
  const [cls,label] = statusMap[job.status];
  const views = job.views || 0;
  const conversion = views>0 ? Math.round((applicantCount/views)*100) : 0;
  return `
  <div class="job-card" data-manage-job="${job.id}">
    <div class="job-card-top">
      <div class="job-card-company"><div class="job-card-title">${job.title}</div></div>
      <span class="status-badge ${cls}">${label}</span>
    </div>
    <div class="job-card-tags">
      <span class="tag">${modeIcon[job.mode]} ${job.distance} km</span>
      <span class="tag">${job.type}</span>
      <span class="tag">Age ${job.age_req}+</span>
    </div>
    <div class="job-analytics-row">
      <span title="Views">👁 ${views}</span>
      <span title="Applicants">📨 ${applicantCount}</span>
      <span title="Conversion rate">📈 ${conversion}%</span>
    </div>
    <div class="job-card-bottom">
      <span class="job-card-wage">${job.wage} kr/hr</span>
      <span class="muted" style="font-size:12px;">Click for details</span>
    </div>
  </div>`;
}
/* Company clicks a job in "Manage listings" — shows the job's full
   details plus everyone who applied specifically to THIS job, with
   accept/reject actions, and an option to take the listing down. */
async function openCompanyJobModal(jobId){
  const { data: job, error } = await supabase.from('jobs').select('*').eq('id', jobId).single();
  logSupabaseError('openCompanyJobModal', error);
  if(!job) return;
  const { data: apps } = await supabase
    .from('applications')
    .select('*, teen:profiles!applications_teen_id_fkey(*)')
    .eq('job_id', jobId)
    .order('created_at', {ascending:false});
  const applicants = apps || [];
  const statusMap = { pending:['status-pending','Pending review'], approved:['status-approved','Live'], rejected:['status-rejected','Rejected'] };
  const [cls,label] = statusMap[job.status];
  const appStatusMap = { applied:['status-pending','Applied'], accepted:['status-accepted','Accepted'], rejected:['status-rejected','Rejected'] };

  $('#companyJobModalContent').innerHTML = `
    <h2 class="jm-title">${job.title}</h2>
    <div class="jm-badges"><span class="status-badge ${cls}">${label}</span><span class="badge badge-live">${applicants.length} applicants</span></div>
    <div class="jm-grid">
      <div class="jm-stat"><label>Hourly wage</label><p style="color:var(--amber)">${job.wage} kr/hr</p></div>
      <div class="jm-stat"><label>Category</label><p>${job.category||'—'}</p></div>
      <div class="jm-stat"><label>Applications close</label><p>${job.deadline ? new Date(job.deadline).toLocaleDateString() : '—'}</p></div>
      <div class="jm-stat"><label>Age requirement</label><p>${job.age_req}+</p></div>
    </div>
    <div class="jm-section"><h4>Description</h4><p>${job.description||''}</p></div>
    <div class="jm-section">
      <h4>Applicants for this job (${applicants.length})</h4>
      <div class="application-list" id="companyJobApplicantList" style="margin-top:10px;">
        ${applicants.length ? applicants.map(a=>{
          if(!a.teen) return '';
          const [acls,alabel] = appStatusMap[a.status] || ['status-pending', a.status];
          const actions = a.status==='applied'
            ? `<button data-modal-accept="${a.id}">Accept</button><button data-modal-reject="${a.id}">Reject</button>`
            : a.status==='accepted' ? `<button data-modal-chat="${a.teen.id}">Message</button>` : `<span class="muted" style="font-size:12px;">Closed</span>`;
          return `<div class="app-row">
            <div class="app-row-left">
              ${logoBoxHTML(a.teen, null, "applicant-avatar")}
              <div><div class="app-row-title">${a.teen.name}${a.teen.age?`, ${a.teen.age}`:''}</div><div class="app-row-sub">Applied ${daysAgo(a.created_at)}</div></div>
            </div>
            <span class="status-badge ${acls}">${alabel}</span>
            <div class="applicant-actions">${actions}</div>
          </div>`;
        }).join('') : `<p class="jobs-empty">No one has applied yet.</p>`}
      </div>
    </div>
    <div class="jm-actions-wrap">
      <button class="btn btn-secondary" style="background:rgba(240,68,56,0.12);color:#FCA5A5;" id="companyJobDeleteBtn">🗑️ Take down this job</button>
    </div>
  `;
  $('#companyJobModalOverlay').classList.add('open');
  $$('#companyJobApplicantList [data-modal-accept]').forEach(btn=> btn.addEventListener('click', async ()=>{ await respondToApplication(btn.dataset.modalAccept, 'accepted'); await openCompanyJobModal(jobId); }));
  $$('#companyJobApplicantList [data-modal-reject]').forEach(btn=> btn.addEventListener('click', async ()=>{ await respondToApplication(btn.dataset.modalReject, 'rejected'); await openCompanyJobModal(jobId); }));
  $$('#companyJobApplicantList [data-modal-chat]').forEach(btn=> btn.addEventListener('click', async ()=>{ closeModal('companyJobModalOverlay'); await openCompanyChatWith(btn.dataset.modalChat); document.getElementById('companyMessagesSection').scrollIntoView({behavior:'smooth'}); }));
  $('#companyJobDeleteBtn').addEventListener('click', async ()=>{
    if(!window.confirm(`Take down "${job.title}"? This can't be undone.`)) return;
    const { error: delErr } = await supabase.from('jobs').delete().eq('id', jobId);
    logSupabaseError('company delete job', delErr);
    if(delErr){ pushToast('🚫','Could not delete', delErr.message); return; }
    pushToast('🗑️','Job removed', '');
    closeModal('companyJobModalOverlay');
    await renderCompanyDashboard();
  });
}
$('#companyJobModalClose').addEventListener('click', ()=>closeModal('companyJobModalOverlay'));
$('#companyJobModalOverlay').addEventListener('click', e=>{ if(e.target.id==='companyJobModalOverlay') closeModal('companyJobModalOverlay'); });

async function respondToApplication(appId, status){
  const { data: app, error } = await supabase.from('applications').update({ status }).eq('id', appId).select('*, job:jobs(*)').single();
  logSupabaseError('respondToApplication', error);
  if(error || !app) return;
  if(status === 'accepted'){
    const { data: existing } = await supabase.from('chats').select('id').eq('teen_id', app.teen_id).eq('company_id', app.company_id).maybeSingle();
    if(!existing){
      const { data: chat, error: chatErr } = await supabase.from('chats').insert({ teen_id:app.teen_id, company_id:app.company_id, job_id:app.job_id }).select().single();
      logSupabaseError('create chat', chatErr);
      if(chat){
        await supabase.from('messages').insert({ chat_id:chat.id, sender_id:app.company_id, text:`You're connected — accepted for ${app.job.title}! Say hi 👋` });
      }
    }
    pushToast('✅','Applicant accepted', 'Chat unlocked for both of you');
  } else {
    pushToast('👋','Applicant declined', '');
  }
  await renderCompanyDashboard();
}

$('#postJobBtn').addEventListener('click', ()=>{
  const user = currentUser();
  if(!user || user.role!=='company') return;
  if(!user.approved){ pushToast('⏳','Account pending review', "You can post jobs once an admin approves your company"); return; }
  $('#postJobModalOverlay').classList.add('open');
});
$('#postJobModalClose').addEventListener('click', ()=>closeModal('postJobModalOverlay'));
$('#postJobModalOverlay').addEventListener('click', e=>{ if(e.target.id==='postJobModalOverlay') closeModal('postJobModalOverlay'); });
function autoMode(distanceKm){
  if(distanceKm <= 1.5) return 'walk';
  if(distanceKm <= 5) return 'bike';
  return 'transit';
}
$('#postJobForm').addEventListener('submit', async e=>{
  e.preventDefault();
  if(!supabase){ pushToast('🚫','No connection','Cannot reach the database right now'); return; }
  const user = currentUser();
  const distance = user.distance || 1.5;
  const job = {
    company_id:user.id,
    title:$('#pjTitle').value.trim(), wage:Number($('#pjWage').value), age_req:Number($('#pjAge').value),
    type:$('#pjType').value, category:$('#pjCategory').value, mode:autoMode(distance),
    deadline:$('#pjDeadline').value || null, hours:$('#pjHours').value.trim(),
    location:$('#pjLocation').value.trim(), description:$('#pjDescription').value.trim(),
    notes:$('#pjNotes').value.trim() || null,
    requirements:[`Minimum age ${$('#pjAge').value}`, 'Reliable and punctual', 'No experience required — full training provided'],
    distance, buzz: Math.floor(Math.random()*10)+1,
  };
  const { error } = await supabase.from('jobs').insert(job);
  logSupabaseError('post job', error);
  if(error){ pushToast('🚫','Could not submit', error.message); return; }
  closeModal('postJobModalOverlay');
  e.target.reset();
  pushToast(user.verified ? '✅' : '⏳', user.verified ? 'Job posted — live now!' : 'Submitted for review', user.verified ? 'Verified companies go live instantly' : 'An admin will approve your listing shortly');
  await renderCompanyDashboard();
});

$('#companyProfileForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const user = currentUser(); if(!user) return;
  const { error } = await supabase.from('profiles').update({
    name: $('#cpName').value.trim(),
    category: $('#cpCategory').value,
    bio: $('#cpBio').value.trim(),
  }).eq('id', user.id);
  if(error){ logSupabaseError('save company profile', error); pushToast('🚫','Could not save', error.message); return; }
  await refreshCurrentProfile();
  pushToast('✅','Profile updated', '');
  await renderCompanyDashboard();
});
$('#cpLogoInput').addEventListener('change', async e=>{
  const file = e.target.files[0]; if(!file) return;
  pushToast('⏳','Uploading logo…', '');
  const url = await uploadProfilePhoto(file);
  if(!url) return;
  const { error } = await supabase.from('profiles').update({ logo_url:url }).eq('id', currentUser().id);
  if(error){ logSupabaseError('save company logo', error); pushToast('🚫','Could not save logo', error.message); return; }
  await refreshCurrentProfile();
  pushToast('✅','Logo updated', '');
  await renderCompanyDashboard();
});

// Sidebar scroll-to
$$('.dash-nav-item[data-panel]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    $$('.dash-nav-item[data-panel]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const map = { overview:'', profile:'#teenProfileSection', hot:'#hotJobsSection', recommended:'#dashRecommended', saved:'#dashRecommended', applications:'#dashApplications', interviews:'#dashInterviews', messages:'#teenMessagesSection' };
    const sel = map[btn.dataset.panel];
    if(sel) document.querySelector(sel).closest('.dash-section, .dash-columns').scrollIntoView({behavior:'smooth', block:'start'});
  });
});
$$('.dash-nav-item[data-cpanel]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    $$('.dash-nav-item[data-cpanel]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const map = { overview:'', profile:'#companyProfileSection', listings:'#companyListingsSection', applicants:'#applicantTable', messages:'#companyMessagesSection' };
    const sel = map[btn.dataset.cpanel];
    if(sel) document.querySelector(sel).closest('.dash-section, .dash-columns').scrollIntoView({behavior:'smooth', block:'start'});
  });
});
$$('.dash-nav-item[data-apanel]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    $$('.dash-nav-item[data-apanel]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const map = { companies:'#adminCompaniesSection', allCompanies:'#adminAllCompaniesSection', teens:'#adminTeensSection', jobs:'#adminJobsSection', all:'#adminAllSection', messages:'#adminMessagesSection' };
    document.querySelector(map[btn.dataset.apanel]).scrollIntoView({behavior:'smooth', block:'start'});
  });
});

// ------------------------------------------------------------
// 10. ADMIN VIEW
// ------------------------------------------------------------
async function renderAdmin(){
  const user = currentUser();
  if(!user || user.role!=='admin'){ showView('landing'); return; }

  const { data: pendingCompanies } = await supabase.from('profiles').select('*').eq('role','company').eq('approved', false);
  const { data: pendingJobs } = await supabase.from('jobs').select('*, company:profiles!jobs_company_id_fkey(*)').eq('status','pending');
  const { data: allCompanies } = await supabase.from('profiles').select('*').eq('role','company').order('created_at', {ascending:false});
  const { data: allTeens } = await supabase.from('profiles').select('*').eq('role','teen').order('created_at', {ascending:false});
  const { data: liveJobsList } = await supabase.from('jobs').select('id').eq('status','approved');
  const { data: allJobsList } = await supabase.from('jobs').select('*, company:profiles!jobs_company_id_fkey(*)').order('created_at', {ascending:false});
  const approvedCos = (allCompanies||[]).filter(c=>c.approved);
  const bannedCount = [...(allCompanies||[]), ...(allTeens||[])].filter(u=>u.banned).length;

  $('#adminPendingCompaniesCount').textContent = (pendingCompanies||[]).length;
  $('#adminPendingCompaniesCount').dataset.count = (pendingCompanies||[]).length;
  $('#adminPendingJobsCount').textContent = (pendingJobs||[]).length;
  $('#adminPendingJobsCount').dataset.count = (pendingJobs||[]).length;
  $('#adminApprovedCount').textContent = approvedCos.length;
  $('#adminApprovedCount').dataset.count = approvedCos.length;
  $('#adminLiveJobsCount').textContent = (liveJobsList||[]).length;
  $('#adminLiveJobsCount').dataset.count = (liveJobsList||[]).length;
  $('#adminTotalTeensCount').textContent = (allTeens||[]).length;
  $('#adminTotalTeensCount').dataset.count = (allTeens||[]).length;
  $('#adminBannedCount').textContent = bannedCount;
  $('#adminBannedCount').dataset.count = bannedCount;

  $('#adminCompaniesList').innerHTML = (pendingCompanies||[]).length ? pendingCompanies.map(c=>`
    <div class="review-card" data-view-company="${c.id}">
      ${logoBoxHTML(c)}
      <div class="review-card-info">
        <div class="review-card-title">${c.name}</div>
        <div class="review-card-sub">${c.category||''} · Applied ${daysAgo(c.created_at)}</div>
      </div>
      <div class="review-card-actions">
        <button class="btn-approve" data-approve-co="${c.id}">Approve</button>
        <button class="btn-reject" data-reject-co="${c.id}">Reject</button>
      </div>
    </div>`).join('') : `<p class="review-empty">No pending company accounts. 🎉</p>`;

  $('#adminAllCompaniesList').innerHTML = (allCompanies||[]).length ? allCompanies.map(c=>`
    <div class="review-card" data-view-company="${c.id}">
      ${logoBoxHTML(c)}
      <div class="review-card-info">
        <div class="review-card-title">${c.name}</div>
        <div class="review-card-sub">${c.category||''} · Joined ${daysAgo(c.created_at)}</div>
        ${c.banned ? `<div class="ban-notice">🚫 Banned${c.ban_reason ? ': '+c.ban_reason : ''}</div>` : ''}
      </div>
      <div class="review-card-actions admin-toggle-row">
        <button class="toggle-pill ${c.approved?'on':''}" data-toggle="approved" data-id="${c.id}">${c.approved?'✔ Approved':'Approve'}</button>
        <button class="toggle-pill ${c.verified?'on':''}" data-toggle="verified" data-id="${c.id}">${c.verified?'✔ Verified':'Verify'}</button>
        <button class="toggle-pill ${c.featured?'on':''}" data-toggle="featured" data-id="${c.id}">${c.featured?'★ Featured':'Feature'}</button>
        <button class="btn-chat" data-admin-chat-company="${c.id}">💬 Chat</button>
        ${c.banned ? `<button class="btn-unban" data-unban="${c.id}">Unban</button>` : `<button class="btn-ban" data-ban="${c.id}">Ban</button>`}
      </div>
    </div>`).join('') : `<p class="review-empty">No companies yet.</p>`;

  $('#adminTeensList').innerHTML = (allTeens||[]).length ? allTeens.map(t=>`
    <div class="review-card" data-view-teen="${t.id}">
      ${logoBoxHTML(t, null, "applicant-avatar")}
      <div class="review-card-info">
        <div class="review-card-title">${t.name}${t.age?`, ${t.age}`:''}</div>
        <div class="review-card-sub">${t.city||''} · Joined ${daysAgo(t.created_at)}</div>
        ${t.banned ? `<div class="ban-notice">🚫 Banned${t.ban_reason ? ': '+t.ban_reason : ''}</div>` : ''}
      </div>
      <div class="review-card-actions admin-toggle-row">
        <button class="btn-chat" data-admin-chat-teen="${t.id}">💬 Chat</button>
        ${t.banned ? `<button class="btn-unban" data-unban="${t.id}">Unban</button>` : `<button class="btn-ban" data-ban="${t.id}">Ban</button>`}
      </div>
    </div>`).join('') : `<p class="review-empty">No teens yet.</p>`;

  $('#adminJobsList').innerHTML = (pendingJobs||[]).length ? pendingJobs.map(j=>{
    const c = j.company;
    return `<div class="review-card" data-view-job="${j.id}">
      ${logoBoxHTML(c)}
      <div class="review-card-info">
        <div class="review-card-title">${j.title} <span class="muted">· ${c.name}</span></div>
        <div class="review-card-sub">${j.wage} kr/hr · ${j.type} · ${j.location||''} · Submitted ${daysAgo(j.created_at)}</div>
      </div>
      <div class="review-card-actions">
        <button class="btn-approve" data-approve-job="${j.id}">Approve</button>
        <button class="btn-reject" data-reject-job="${j.id}">Reject</button>
      </div>
    </div>`;
  }).join('') : `<p class="review-empty">No pending jobs. 🎉</p>`;

  $('#adminAllList').innerHTML = (allJobsList||[]).map(j=>{
    const c = j.company; if(!c) return '';
    const statusMap = { pending:['status-pending','Pending'], approved:['status-approved','Live'], rejected:['status-rejected','Rejected'] };
    const [cls,label] = statusMap[j.status];
    return `<div class="review-card" data-view-job="${j.id}">
      ${logoBoxHTML(c)}
      <div class="review-card-info"><div class="review-card-title">${j.title} <span class="muted">· ${c.name}</span></div><div class="review-card-sub">${j.wage} kr/hr · ${j.location||''}</div></div>
      <span class="status-badge ${cls}">${label}</span>
      <button class="btn-reject" data-delete-job="${j.id}">Delete</button>
    </div>`;
  }).join('');

  // Whole card opens the detail modal; buttons inside stop that and do their own thing.
  $$('.review-card[data-view-company]').forEach(card=>{
    card.addEventListener('click', e=>{ if(e.target.closest('button')) return; openUserDetailModal(card.dataset.viewCompany, 'company'); });
  });
  $$('.review-card[data-view-teen]').forEach(card=>{
    card.addEventListener('click', e=>{ if(e.target.closest('button')) return; openUserDetailModal(card.dataset.viewTeen, 'teen'); });
  });
  $$('.review-card[data-view-job]').forEach(card=>{
    card.addEventListener('click', e=>{ if(e.target.closest('button')) return; openJobAdminModal(card.dataset.viewJob); });
  });

  $$('[data-approve-co]').forEach(btn=> btn.addEventListener('click', e=>{ e.stopPropagation(); reviewCompany(btn.dataset.approveCo, true); }));
  $$('[data-reject-co]').forEach(btn=> btn.addEventListener('click', e=>{ e.stopPropagation(); reviewCompany(btn.dataset.rejectCo, false); }));
  $$('[data-approve-job]').forEach(btn=> btn.addEventListener('click', e=>{ e.stopPropagation(); reviewJob(btn.dataset.approveJob, 'approved'); }));
  $$('[data-reject-job]').forEach(btn=> btn.addEventListener('click', e=>{ e.stopPropagation(); reviewJob(btn.dataset.rejectJob, 'rejected'); }));
  $$('[data-toggle]').forEach(btn=> btn.addEventListener('click', e=>{ e.stopPropagation(); toggleCompanyFlag(btn.dataset.id, btn.dataset.toggle, !btn.classList.contains('on')); }));
  $$('[data-ban]').forEach(btn=> btn.addEventListener('click', e=>{ e.stopPropagation(); banUser(btn.dataset.ban, true); }));
  $$('[data-unban]').forEach(btn=> btn.addEventListener('click', e=>{ e.stopPropagation(); banUser(btn.dataset.unban, false); }));
  $$('[data-delete-job]').forEach(btn=> btn.addEventListener('click', e=>{ e.stopPropagation(); deleteJob(btn.dataset.deleteJob); }));
  $$('[data-admin-chat-company]').forEach(btn=> btn.addEventListener('click', e=>{ e.stopPropagation(); openAdminChatWith(btn.dataset.adminChatCompany, 'company'); }));
  $$('[data-admin-chat-teen]').forEach(btn=> btn.addEventListener('click', e=>{ e.stopPropagation(); openAdminChatWith(btn.dataset.adminChatTeen, 'teen'); }));

  await renderAdminChatList();
  observeCounters();
}
async function reviewCompany(id, approve){
  // Approving only grants permission to post jobs — it no longer
  // auto-verifies. Verified/Featured are independent admin toggles
  // now, controlled from the "Manage companies" panel.
  const { error } = await supabase.from('profiles').update({ approved: approve }).eq('id', id);
  logSupabaseError('reviewCompany', error);
  if(error){ pushToast('🚫','Update failed', error.message); return; }
  pushToast(approve?'✅':'🚫', approve?'Company approved':'Company rejected', '');
  await renderAdmin();
}
async function toggleCompanyFlag(id, field, value){
  const { error } = await supabase.from('profiles').update({ [field]: value }).eq('id', id);
  logSupabaseError('toggleCompanyFlag', error);
  if(error){ pushToast('🚫','Update failed', error.message); return; }
  const labels = { approved:'Approved', verified:'Verified', featured:'Featured' };
  pushToast(value?'✅':'➖', `${labels[field]} ${value?'enabled':'disabled'}`, '');
  await renderAdmin();
}
async function reviewJob(id, status){
  const { error } = await supabase.from('jobs').update({ status }).eq('id', id);
  logSupabaseError('reviewJob', error);
  if(error){ pushToast('🚫','Update failed', error.message); return; }
  pushToast(status==='approved'?'✅':'🚫', status==='approved'?'Job approved':'Job rejected', '');
  await renderAdmin();
}
async function banUser(id, ban){
  let reason = null;
  if(ban){
    reason = window.prompt('Reason for banning this account (shown to them, and kept on record):');
    if(reason === null) return; // cancelled
  }
  const { error } = await supabase.from('profiles').update({ banned: ban, ban_reason: ban ? reason : null, banned_until: null }).eq('id', id);
  logSupabaseError('banUser', error);
  if(error){ pushToast('🚫','Update failed', error.message); return; }
  pushToast(ban?'🚫':'✅', ban?'Account banned':'Account unbanned', '');
  await renderAdmin();
  closeModal('userDetailModalOverlay');
}
async function timeoutUser(id){
  const daysStr = window.prompt('Timeout length in days (e.g. 3):', '3');
  if(daysStr === null) return;
  const days = Number(daysStr);
  if(!days || days <= 0){ pushToast('🚫','Invalid number', 'Enter a positive number of days'); return; }
  const reason = window.prompt('Reason for this timeout (shown to them):') || 'No reason given';
  const until = new Date(Date.now() + days*86400000).toISOString();
  const { error } = await supabase.from('profiles').update({ banned_until: until, ban_reason: reason }).eq('id', id);
  logSupabaseError('timeoutUser', error);
  if(error){ pushToast('🚫','Update failed', error.message); return; }
  pushToast('⏱️','Timeout applied', `${days} day${days>1?'s':''}`);
  await renderAdmin();
  closeModal('userDetailModalOverlay');
}
async function warnUser(id){
  const message = window.prompt('Warning message (the account will see this):');
  if(!message) return;
  const { error } = await supabase.from('warnings').insert({ profile_id:id, message, created_by: currentUser().id });
  logSupabaseError('warnUser', error);
  if(error){ pushToast('🚫','Could not send warning', error.message); return; }
  pushToast('⚠️','Warning sent', '');
  await openUserDetailModal(id, lastOpenedUserRole);
}
async function deleteJob(id){
  if(!window.confirm('Permanently delete this job listing? This cannot be undone.')) return;
  const { error } = await supabase.from('jobs').delete().eq('id', id);
  logSupabaseError('deleteJob', error);
  if(error){ pushToast('🚫','Delete failed', error.message); return; }
  pushToast('🗑️','Job deleted', '');
  await renderAdmin();
  closeModal('jobAdminModalOverlay');
}

/* ---------- Admin: user detail / moderation modal ---------- */
let lastOpenedUserRole = 'company';
async function openUserDetailModal(id, role){
  lastOpenedUserRole = role;
  const { data: p, error } = await supabase.from('profiles').select('*').eq('id', id).single();
  logSupabaseError('openUserDetailModal', error);
  if(!p) return;

  const { data: warningsList } = await supabase.from('warnings').select('*').eq('profile_id', id).order('created_at', {ascending:false});

  let statsHTML = '';
  if(role === 'company'){
    const { data: jobs } = await supabase.from('jobs').select('id,status').eq('company_id', id);
    const { data: apps } = await supabase.from('applications').select('id').eq('company_id', id);
    const j = jobs || [];
    statsHTML = `
      <div class="jm-grid">
        <div class="jm-stat"><label>Live jobs</label><p>${j.filter(x=>x.status==='approved').length}</p></div>
        <div class="jm-stat"><label>Pending jobs</label><p>${j.filter(x=>x.status==='pending').length}</p></div>
        <div class="jm-stat"><label>Total applicants</label><p>${(apps||[]).length}</p></div>
        <div class="jm-stat"><label>Joined</label><p>${daysAgo(p.created_at)}</p></div>
      </div>`;
  } else {
    const { data: apps } = await supabase.from('applications').select('id,status').eq('teen_id', id);
    const { data: saved } = await supabase.from('saved_jobs').select('job_id').eq('teen_id', id);
    const a = apps || [];
    statsHTML = `
      <div class="jm-grid">
        <div class="jm-stat"><label>Applications</label><p>${a.length}</p></div>
        <div class="jm-stat"><label>Accepted</label><p>${a.filter(x=>x.status==='accepted').length}</p></div>
        <div class="jm-stat"><label>Saved jobs</label><p>${(saved||[]).length}</p></div>
        <div class="jm-stat"><label>Joined</label><p>${daysAgo(p.created_at)}</p></div>
      </div>`;
  }

  const isTimedOut = p.banned_until && new Date(p.banned_until) > new Date();
  const statusLine = p.banned
    ? `<span class="badge" style="background:rgba(240,68,56,0.14);color:#FCA5A5;">🚫 Banned${p.ban_reason ? ' — '+p.ban_reason : ''}</span>`
    : isTimedOut
      ? `<span class="badge" style="background:rgba(245,165,36,0.16);color:var(--amber);">⏱️ Timed out until ${new Date(p.banned_until).toLocaleDateString()}${p.ban_reason ? ' — '+p.ban_reason : ''}</span>`
      : `<span class="badge badge-live">✔ Active account</span>`;

  $('#userDetailModalContent').innerHTML = `
    <div class="jm-head">${logoBoxHTML(p, 56, role==='company'?'company-logo':'applicant-avatar')}</div>
    <h2 class="jm-title">${p.name}</h2>
    <p class="jm-company">${p.email || ''}${role==='company' ? ' · '+(p.category||'') : (p.age?` · ${p.age} yrs old`:'')}${p.city?` · ${p.city}`:''}</p>
    <div class="jm-badges">
      ${role==='company' && p.verified ? `<span class="badge badge-verified">${VERIFIED_BADGE} Verified</span>` : ''}
      ${role==='company' && p.featured ? '<span class="badge badge-featured">★ Featured</span>' : ''}
      ${statusLine}
    </div>
    ${p.bio ? `<div class="jm-section"><h4>About</h4><p>${p.bio}</p></div>` : ''}
    ${statsHTML}
    ${(warningsList||[]).length ? `
      <div class="jm-section"><h4>⚠️ Warning history</h4><ul>${warningsList.map(w=>`<li>${w.message} <span class="muted">— ${daysAgo(w.created_at)}</span></li>`).join('')}</ul></div>
    ` : ''}
    <div class="jm-actions-wrap">
      ${role==='company' ? `<button class="btn btn-secondary" data-modal-toggle="approved">${p.approved?'✔ Approved':'Approve'}</button>` : ''}
      ${role==='company' ? `<button class="btn btn-secondary" data-modal-toggle="verified">${p.verified?'✔ Verified':'Verify'}</button>` : ''}
      ${role==='company' ? `<button class="btn btn-secondary" data-modal-toggle="featured">${p.featured?'★ Featured':'Feature'}</button>` : ''}
      <button class="btn btn-secondary" id="modalWarnBtn">⚠️ Warn</button>
      <button class="btn btn-secondary" id="modalTimeoutBtn">⏱️ Timeout</button>
      ${p.banned ? `<button class="btn btn-secondary" id="modalUnbanBtn">✅ Unban</button>` : `<button class="btn btn-secondary" style="background:rgba(240,68,56,0.12);color:#FCA5A5;" id="modalBanBtn">🚫 Ban</button>`}
      <button class="btn btn-primary" id="modalChatBtn">💬 Chat</button>
    </div>
  `;
  $('#userDetailModalOverlay').classList.add('open');
  $$('#userDetailModalContent [data-modal-toggle]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const field = btn.dataset.modalToggle;
      await toggleCompanyFlag(p.id, field, !p[field]);
      await openUserDetailModal(p.id, role);
    });
  });
  $('#modalWarnBtn')?.addEventListener('click', ()=> warnUser(p.id));
  $('#modalTimeoutBtn')?.addEventListener('click', ()=> timeoutUser(p.id));
  $('#modalBanBtn')?.addEventListener('click', ()=> banUser(p.id, true));
  $('#modalUnbanBtn')?.addEventListener('click', ()=> banUser(p.id, false));
  $('#modalChatBtn')?.addEventListener('click', ()=>{ closeModal('userDetailModalOverlay'); openAdminChatWith(p.id, role); });
}
$('#userDetailModalClose').addEventListener('click', ()=>closeModal('userDetailModalOverlay'));
$('#userDetailModalOverlay').addEventListener('click', e=>{ if(e.target.id==='userDetailModalOverlay') closeModal('userDetailModalOverlay'); });

/* ---------- Admin: job detail / moderation modal ---------- */
async function openJobAdminModal(jobId){
  const { data: j, error } = await supabase.from('jobs').select('*, company:profiles!jobs_company_id_fkey(*)').eq('id', jobId).single();
  logSupabaseError('openJobAdminModal', error);
  if(!j) return;
  const c = j.company;
  const { data: apps } = await supabase.from('applications').select('id').eq('job_id', jobId);
  const statusMap = { pending:['status-pending','Pending review'], approved:['status-approved','Live'], rejected:['status-rejected','Rejected'] };
  const [cls,label] = statusMap[j.status];

  $('#jobAdminModalContent').innerHTML = `
    <div class="jm-head">${logoBoxHTML(c, 48)}</div>
    <h2 class="jm-title">${j.title}</h2>
    <p class="jm-company">${c.name} · ${j.location||''}</p>
    <div class="jm-badges"><span class="status-badge ${cls}">${label}</span><span class="badge badge-live">${(apps||[]).length} applicants</span></div>
    <div class="jm-grid">
      <div class="jm-stat"><label>Hourly wage</label><p style="color:var(--amber)">${j.wage} kr/hr</p></div>
      <div class="jm-stat"><label>Category</label><p>${j.category||'—'}</p></div>
      <div class="jm-stat"><label>Applications close</label><p>${j.deadline ? new Date(j.deadline).toLocaleDateString() : '—'}</p></div>
      <div class="jm-stat"><label>Age requirement</label><p>${j.age_req}+</p></div>
    </div>
    <div class="jm-section"><h4>Description</h4><p>${j.description||''}</p></div>
    ${j.notes ? `<div class="jm-section"><h4>Other info</h4><p>${j.notes}</p></div>` : ''}
    <div class="jm-actions-wrap">
      ${j.status!=='approved' ? `<button class="btn btn-secondary" id="jobModalApprove">✅ Approve</button>` : ''}
      ${j.status!=='rejected' ? `<button class="btn btn-secondary" id="jobModalReject">🚫 Reject</button>` : ''}
      <button class="btn btn-secondary" id="jobModalWarnCompany">⚠️ Warn company</button>
      <button class="btn btn-secondary" style="background:rgba(240,68,56,0.12);color:#FCA5A5;" id="jobModalDelete">🗑️ Take down permanently</button>
    </div>
  `;
  $('#jobAdminModalOverlay').classList.add('open');
  $('#jobModalApprove')?.addEventListener('click', async ()=>{ await reviewJob(j.id,'approved'); closeModal('jobAdminModalOverlay'); });
  $('#jobModalReject')?.addEventListener('click', async ()=>{ await reviewJob(j.id,'rejected'); closeModal('jobAdminModalOverlay'); });
  $('#jobModalDelete')?.addEventListener('click', ()=> deleteJob(j.id));
  $('#jobModalWarnCompany')?.addEventListener('click', async ()=>{
    const message = window.prompt(`Warning message for ${c.name} about "${j.title}":`);
    if(!message) return;
    const { error: wErr } = await supabase.from('warnings').insert({ profile_id:c.id, message, created_by: currentUser().id });
    if(wErr){ pushToast('🚫','Could not send warning', wErr.message); return; }
    pushToast('⚠️','Warning sent', c.name);
  });
}
$('#jobAdminModalClose').addEventListener('click', ()=>closeModal('jobAdminModalOverlay'));
$('#jobAdminModalOverlay').addEventListener('click', e=>{ if(e.target.id==='jobAdminModalOverlay') closeModal('jobAdminModalOverlay'); });

// ------------------------------------------------------------
// 11. CHAT (with realtime updates)
// ------------------------------------------------------------
let activeTeenChatId = null;
let activeCompanyChatId = null;
let activeMessageChannel = null;

async function renderTeenChatList(){
  const user = currentUser(); if(!user) return;
  const { data: chats, error: chatsErr } = await supabase.from('chats').select('*, company:profiles!chats_company_id_fkey(*), admin:profiles!chats_admin_id_fkey(*)').eq('teen_id', user.id);
  logSupabaseError('renderTeenChatList', chatsErr);
  const list = chats || [];
  const listEl = $('#teenChatList');
  const previews = await Promise.all(list.map(async c=>{
    const { data: last } = await supabase.from('messages').select('text').eq('chat_id', c.id).order('created_at', {ascending:false}).limit(1).maybeSingle();
    return { ...c, preview: last?.text || '' };
  }));
  listEl.innerHTML = previews.length ? previews.filter(c=> c.company || c.admin).map(c=>{
    const other = c.company || c.admin;
    const label = c.admin ? `${other.name} <span class="muted" style="font-size:11px;">· Treak team</span>` : other.name;
    return `<div class="chat-list-item ${c.id===activeTeenChatId?'active':''}" data-chat-id="${c.id}">
      ${logoBoxHTML(other, null, "chat-list-avatar")}
      <div><div class="chat-list-name">${label}</div><div class="chat-list-preview">${c.preview}</div></div>
    </div>`;
  }).join('') : `<div class="chat-list-empty">No conversations yet — get accepted for a job to start chatting.</div>`;
  $$('#teenChatList [data-chat-id]').forEach(item=> item.addEventListener('click', ()=> openTeenChat(item.dataset.chatId)));
  if(!activeTeenChatId && list.length) await openTeenChat(list[0].id);
  else if(activeTeenChatId) await renderTeenChatThread();
  else $('#teenChatThread').innerHTML = `<div class="chat-thread-empty">Select a conversation to start chatting.</div>`;
}
async function openTeenChatWith(companyId){
  const user = currentUser();
  const { data: chat } = await supabase.from('chats').select('id').eq('teen_id', user.id).eq('company_id', companyId).maybeSingle();
  if(chat) await openTeenChat(chat.id);
}
async function openTeenChat(chatId){
  activeTeenChatId = chatId;
  await renderTeenChatList();
}
async function renderTeenChatThread(){
  const { data: chat } = await supabase.from('chats').select('*, company:profiles!chats_company_id_fkey(*), admin:profiles!chats_admin_id_fkey(*)').eq('id', activeTeenChatId).single();
  if(!chat) return;
  const co = chat.company || chat.admin || { name:'Unknown', color:'var(--gradient)' };
  $('#teenChatThread').innerHTML = `
    <div class="chat-thread-header">${logoBoxHTML(co, null, "chat-list-avatar")}<div><div class="chat-list-name">${co.name}</div><div class="chat-list-preview">Active conversation</div></div></div>
    <div class="chat-thread-messages" id="teenChatMessages"></div>
    <div class="chat-thread-input"><input type="text" id="teenChatInput" placeholder="Message ${co.name}…"><button id="teenChatSend">➤</button></div>`;
  await loadAndRenderMessages(chat.id, $('#teenChatMessages'), currentUser().id);
  subscribeToChat(chat.id, $('#teenChatMessages'), currentUser().id);
  $('#teenChatSend').addEventListener('click', ()=> sendChatMessage(chat.id, $('#teenChatInput'), $('#teenChatMessages')));
  $('#teenChatInput').addEventListener('keydown', e=>{ if(e.key==='Enter') sendChatMessage(chat.id, $('#teenChatInput'), $('#teenChatMessages')); });
}

async function renderCompanyChatList(){
  const user = currentUser(); if(!user) return;
  const { data: chats, error: chatsErr } = await supabase.from('chats').select('*, teen:profiles!chats_teen_id_fkey(*), admin:profiles!chats_admin_id_fkey(*)').eq('company_id', user.id);
  logSupabaseError('renderCompanyChatList', chatsErr);
  const list = chats || [];
  const listEl = $('#companyChatList');
  const previews = await Promise.all(list.map(async c=>{
    const { data: last } = await supabase.from('messages').select('text').eq('chat_id', c.id).order('created_at', {ascending:false}).limit(1).maybeSingle();
    return { ...c, preview: last?.text || '' };
  }));
  listEl.innerHTML = previews.length ? previews.filter(c=> c.teen || c.admin).map(c=>{
    const other = c.teen || c.admin;
    const label = c.admin ? `${other.name} <span class="muted" style="font-size:11px;">· Treak team</span>` : other.name;
    return `<div class="chat-list-item ${c.id===activeCompanyChatId?'active':''}" data-chat-id="${c.id}">
      ${logoBoxHTML(other, null, "chat-list-avatar")}
      <div><div class="chat-list-name">${label}</div><div class="chat-list-preview">${c.preview}</div></div>
    </div>`;
  }).join('') : `<div class="chat-list-empty">No conversations yet — accept an applicant to start chatting.</div>`;
  $$('#companyChatList [data-chat-id]').forEach(item=> item.addEventListener('click', ()=> openCompanyChat(item.dataset.chatId)));
  if(!activeCompanyChatId && list.length) await openCompanyChat(list[0].id);
  else if(activeCompanyChatId) await renderCompanyChatThread();
  else $('#companyChatThread').innerHTML = `<div class="chat-thread-empty">Select a conversation to start chatting.</div>`;
}
async function openCompanyChatWith(teenId){
  const user = currentUser();
  const { data: chat } = await supabase.from('chats').select('id').eq('company_id', user.id).eq('teen_id', teenId).maybeSingle();
  if(chat) await openCompanyChat(chat.id);
}
async function openCompanyChat(chatId){
  activeCompanyChatId = chatId;
  await renderCompanyChatList();
}
async function renderCompanyChatThread(){
  const { data: chat } = await supabase.from('chats').select('*, teen:profiles!chats_teen_id_fkey(*), admin:profiles!chats_admin_id_fkey(*)').eq('id', activeCompanyChatId).single();
  if(!chat) return;
  const other = chat.teen || chat.admin || { name:'Unknown', color:'var(--gradient)' };
  $('#companyChatThread').innerHTML = `
    <div class="chat-thread-header">${logoBoxHTML(other, null, "chat-list-avatar")}<div><div class="chat-list-name">${other.name}</div><div class="chat-list-preview">Active conversation</div></div></div>
    <div class="chat-thread-messages" id="companyChatMessages"></div>
    <div class="chat-thread-input"><input type="text" id="companyChatInput" placeholder="Message ${other.name}…"><button id="companyChatSend">➤</button></div>`;
  await loadAndRenderMessages(chat.id, $('#companyChatMessages'), currentUser().id);
  subscribeToChat(chat.id, $('#companyChatMessages'), currentUser().id);
  $('#companyChatSend').addEventListener('click', ()=> sendChatMessage(chat.id, $('#companyChatInput'), $('#companyChatMessages')));
  $('#companyChatInput').addEventListener('keydown', e=>{ if(e.key==='Enter') sendChatMessage(chat.id, $('#companyChatInput'), $('#companyChatMessages')); });
}

async function loadAndRenderMessages(chatId, container, myId){
  const { data: messages, error } = await supabase.from('messages').select('*').eq('chat_id', chatId).order('created_at', { ascending:true });
  logSupabaseError('loadAndRenderMessages', error);
  renderChatBubbles(container, messages||[], myId);
}
function renderChatBubbles(container, messages, myId){
  container.innerHTML = messages.map(m=>{
    const mine = m.sender_id === myId;
    return `<div class="chat-bubble ${mine?'me':'them'}">${m.text}<span class="chat-bubble-time">${new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span></div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}
function appendChatBubble(container, text, createdAt, mine){
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${mine?'me':'them'}`;
  bubble.innerHTML = `${text}<span class="chat-bubble-time">${new Date(createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>`;
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}
function subscribeToChat(chatId, container, myId){
  if(activeMessageChannel) supabase.removeChannel(activeMessageChannel);
  activeMessageChannel = supabase
    .channel(`messages-${chatId}`)
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages', filter:`chat_id=eq.${chatId}` }, payload=>{
      const mine = payload.new.sender_id === myId;
      // Your own messages are already shown instantly by sendChatMessage —
      // only append here for messages coming FROM the other person, so
      // conversations never depend solely on the realtime round-trip
      // for your own side, and never show a duplicate bubble either.
      if(mine) return;
      appendChatBubble(container, payload.new.text, payload.new.created_at, false);
      pushToast('💬','New message', payload.new.text);
    })
    .subscribe();
}
async function sendChatMessage(chatId, inputEl, containerEl){
  const text = inputEl.value.trim();
  if(!text) return;
  inputEl.value = '';
  const now = new Date().toISOString();
  if(containerEl) appendChatBubble(containerEl, text, now, true); // show it instantly, don't wait on the network round-trip
  const { error } = await supabase.from('messages').insert({ chat_id:chatId, sender_id:currentUser().id, text });
  logSupabaseError('sendChatMessage', error);
  if(error){ pushToast('🚫','Message not sent', error.message); inputEl.value = text; if(containerEl && containerEl.lastElementChild) containerEl.lastElementChild.remove(); }
}

// ------------------------------------------------------------
// 11b. ADMIN CHAT — admin can message any teen or company directly
// ------------------------------------------------------------
let activeAdminChatId = null;

async function renderAdminChatList(){
  const user = currentUser(); if(!user) return;
  const { data: chats, error: chatsErr } = await supabase
    .from('chats')
    .select('*, teen:profiles!chats_teen_id_fkey(*), company:profiles!chats_company_id_fkey(*)')
    .eq('admin_id', user.id);
  logSupabaseError('renderAdminChatList', chatsErr);
  const list = chats || [];
  const listEl = $('#adminChatList');
  const previews = await Promise.all(list.map(async c=>{
    const { data: last } = await supabase.from('messages').select('text').eq('chat_id', c.id).order('created_at', {ascending:false}).limit(1).maybeSingle();
    return { ...c, preview: last?.text || '' };
  }));
  listEl.innerHTML = previews.length ? previews.map(c=>{
    const other = c.company || c.teen;
    return `<div class="chat-list-item ${c.id===activeAdminChatId?'active':''}" data-chat-id="${c.id}">
      ${logoBoxHTML(other, null, "chat-list-avatar")}
      <div><div class="chat-list-name">${other?.name||'Unknown'} ${c.company?'<span class="muted" style="font-size:11px;">· company</span>':'<span class="muted" style="font-size:11px;">· teen</span>'}</div><div class="chat-list-preview">${c.preview}</div></div>
    </div>`;
  }).join('') : `<div class="chat-list-empty">No conversations yet — click "💬 Chat" next to any company or teen above.</div>`;
  $$('#adminChatList [data-chat-id]').forEach(item=> item.addEventListener('click', ()=> openAdminChat(item.dataset.chatId)));
  if(!activeAdminChatId && list.length) await openAdminChat(list[0].id);
  else if(activeAdminChatId) await renderAdminChatThread();
  else $('#adminChatThread').innerHTML = `<div class="chat-thread-empty">Select a conversation, or start one from the lists above.</div>`;
}
async function openAdminChat(chatId){
  activeAdminChatId = chatId;
  await renderAdminChatList();
}
async function renderAdminChatThread(){
  const { data: chat } = await supabase
    .from('chats')
    .select('*, teen:profiles!chats_teen_id_fkey(*), company:profiles!chats_company_id_fkey(*)')
    .eq('id', activeAdminChatId).single();
  if(!chat) return;
  const other = chat.company || chat.teen;
  $('#adminChatThread').innerHTML = `
    <div class="chat-thread-header">${logoBoxHTML(other, null, "chat-list-avatar")}<div><div class="chat-list-name">${other?.name||'Unknown'}</div><div class="chat-list-preview">Active conversation</div></div></div>
    <div class="chat-thread-messages" id="adminChatMessages"></div>
    <div class="chat-thread-input"><input type="text" id="adminChatInput" placeholder="Message ${other?.name||''}…"><button id="adminChatSend">➤</button></div>`;
  await loadAndRenderMessages(chat.id, $('#adminChatMessages'), currentUser().id);
  subscribeToChat(chat.id, $('#adminChatMessages'), currentUser().id);
  $('#adminChatSend').addEventListener('click', ()=> sendChatMessage(chat.id, $('#adminChatInput'), $('#adminChatMessages')));
  $('#adminChatInput').addEventListener('keydown', e=>{ if(e.key==='Enter') sendChatMessage(chat.id, $('#adminChatInput'), $('#adminChatMessages')); });
}
/* Called from the "💬 Chat" buttons next to any company or teen in the
   admin lists — finds an existing admin conversation with them, or
   creates one on the spot, no application or acceptance required. */
async function openAdminChatWith(participantId, participantType){
  const user = currentUser();
  const filterCol = participantType === 'company' ? 'company_id' : 'teen_id';
  const { data: existing } = await supabase.from('chats').select('id').eq('admin_id', user.id).eq(filterCol, participantId).maybeSingle();
  let chatId = existing?.id;
  if(!chatId){
    const insertRow = { admin_id: user.id, [filterCol]: participantId };
    const { data: created, error } = await supabase.from('chats').insert(insertRow).select().single();
    logSupabaseError('openAdminChatWith', error);
    if(error){ pushToast('🚫','Could not start chat', error.message); return; }
    chatId = created.id;
  }
  document.getElementById('adminMessagesSection').scrollIntoView({behavior:'smooth'});
  await openAdminChat(chatId);
}

// ------------------------------------------------------------
// 12. TOP 10 HOTTEST JOBS
// ------------------------------------------------------------
function hotScore(job){ return job.wage*1.1 + job.buzz*1.6 - job.distance*3.4; }
let hotRadius = 5;
function hotJobRowHTML(job, rank){
  const c = job.company; if(!c) return '';
  const medal = rank<=3 ? `rank-${rank}` : '';
  const maxScore = hotScore({wage:150, buzz:50, distance:0});
  const meterPct = Math.max(8, Math.min(100, Math.round((hotScore(job)/maxScore)*100)));
  return `
  <div class="hot-job-row ${medal}" data-job="${job.id}" style="transition-delay:${rank*45}ms">
    <div class="hot-rank">${rank<=3 ? ['🥇','🥈','🥉'][rank-1] : String(rank).padStart(2,'0')}</div>
    ${logoBoxHTML(c)}
    <div class="hot-job-info">
      <div class="hot-job-title">${job.title} <span class="hot-job-company">· ${c.name}</span></div>
      <div class="hot-job-meta"><span>${modeIcon[job.mode]} ${job.distance} km</span><span>🔥 ${job.buzz} applied this week</span></div>
      <div class="hot-meter-track"><div class="hot-meter-fill" style="width:${meterPct}%"></div></div>
    </div>
    <div class="hot-job-wage">${job.wage}<small>kr/hr</small></div>
    <button class="job-card-apply" data-apply="${job.id}">Apply</button>
  </div>`;
}
async function renderHotJobs(){
  const jobsList = cachedLiveJobs.length ? cachedLiveJobs : await fetchLiveJobs();
  const nearby = jobsList.filter(j=>j.distance<=hotRadius);
  const pool = nearby.length ? nearby : jobsList;
  const top10 = [...pool].sort((a,b)=>hotScore(b)-hotScore(a)).slice(0,10);
  $('#hotJobsList').innerHTML = top10.length ? top10.map((job,i)=>hotJobRowHTML(job,i+1)).join('') : `<p class="jobs-empty">No live jobs yet — this fills up as companies get approved and post listings.</p>`;
  $$('.hot-job-row').forEach(row=> requestAnimationFrame(()=> row.classList.add('in-view')));
  attachJobCardEvents();
}
$('#hotRadiusSlider').addEventListener('input', e=>{
  hotRadius = Number(e.target.value); $('#hotRadiusLabel').textContent = hotRadius; renderHotJobs();
});

// ------------------------------------------------------------
// 13. TOASTS + NOTIFICATIONS
// ------------------------------------------------------------
function pushToast(icon, title, sub){
  const stack = $('#toastStack');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-text">${title}${sub?`<small>${sub}</small>`:''}</span>`;
  stack.appendChild(el);
  setTimeout(()=>{ el.classList.add('leaving'); setTimeout(()=>el.remove(), 320); }, 3800);
}
function renderNotifPanel(){ $('#notifList').innerHTML = `<div class="notif-list-empty" style="padding:20px;color:var(--text-low);font-size:13px;text-align:center;">No notifications yet.</div>`; }
renderNotifPanel();
$('#notifBell').addEventListener('click', e=>{ e.stopPropagation(); $('#notifPanel').classList.toggle('open'); $('#notifDot').style.display='none'; });
document.addEventListener('click', e=>{ if(!e.target.closest('.nav-actions')) $('#notifPanel').classList.remove('open'); });

// ------------------------------------------------------------
// 14. NAV: mobile hamburger, scroll shadow
// ------------------------------------------------------------
$$('.nav-link').forEach(link=>{
  link.addEventListener('click', async e=>{
    const hash = link.getAttribute('href');
    if(!hash || !hash.startsWith('#')) return;
    e.preventDefault();
    if(lastView !== 'landing'){ await showView('landing'); }
    setTimeout(()=>{
      const target = document.querySelector(hash);
      if(target) target.scrollIntoView({ behavior:'smooth', block:'start' });
    }, lastView==='landing' ? 0 : 60);
  });
});
$('#hamburger').addEventListener('click', ()=>{
  const links = $('#navLinks');
  links.style.display = links.style.display === 'flex' ? 'none' : 'flex';
  links.style.cssText += 'position:absolute;top:100%;left:0;right:0;flex-direction:column;background:var(--bg-soft);padding:12px 20px;border-bottom:1px solid var(--border);';
});
window.addEventListener('scroll', ()=>{
  $('#mainNav').style.boxShadow = window.scrollY > 10 ? '0 8px 24px rgba(0,0,0,0.35)' : 'none';
});

// ------------------------------------------------------------
// 15. SCROLL REVEAL + COUNTERS
// ------------------------------------------------------------
const revealObserver = new IntersectionObserver(entries=>{
  entries.forEach(entry=>{ if(entry.isIntersecting){ entry.target.classList.add('in-view'); revealObserver.unobserve(entry.target); } });
}, { threshold:0.15 });
function observeReveals(){ $$('.reveal-up').forEach(el=> revealObserver.observe(el)); }

function animateCounter(el){
  const target = Number(el.dataset.count) || 0;
  const start = performance.now(); const duration=1400;
  function tick(now){
    const progress = Math.min((now-start)/duration,1);
    const eased = 1-Math.pow(1-progress,3);
    el.textContent = Math.round(target*eased);
    if(progress<1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
const counterObserver = new IntersectionObserver(entries=>{
  entries.forEach(entry=>{ if(entry.isIntersecting){ animateCounter(entry.target); counterObserver.unobserve(entry.target); } });
}, { threshold:0.4 });
function observeCounters(){ $$('.counter').forEach(el=> counterObserver.observe(el)); }

// ------------------------------------------------------------
// 16. HERO CARD PARALLAX
// ------------------------------------------------------------
const heroVisual = $('#heroVisual');
if(heroVisual){
  const floatingCards = Array.from(heroVisual.querySelectorAll('.floating-card'));
  heroVisual.addEventListener('mousemove', e=>{
    const rect = heroVisual.getBoundingClientRect();
    const x = (e.clientX-rect.left)/rect.width - 0.5;
    const y = (e.clientY-rect.top)/rect.height - 0.5;
    floatingCards.forEach((card,i)=>{ const depth=(i+1)*8; card.style.transform = `translate(${x*depth}px, ${y*depth}px)`; });
  });
  heroVisual.addEventListener('mouseleave', ()=> floatingCards.forEach(card=> card.style.transform=''));
}

// ------------------------------------------------------------
// 17. INIT
// ------------------------------------------------------------
(async function init(){
  // Always do this first — the page must look and feel finished
  // even if the database connection below has a problem.
  observeReveals();
  observeCounters();
  try{
    await refreshCurrentProfile();
    updateAccountUI();
    await renderCompanies();
    await renderJobs();
    console.log('%cTreak connected to Supabase ✨', 'color:#4F46E5;font-weight:bold;font-size:14px;');
  }catch(err){
    console.error('Treak: startup data load failed —', err);
    showConnectionBanner('Could not load live data from the database. Check the browser console (F12) for the exact error.');
  }
})();

} // end of the duplicate-execution guard from the top of the file
