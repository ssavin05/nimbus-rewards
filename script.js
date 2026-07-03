/* ════════════════════════════════════════════════════════════════
   APP_CONFIG — único lugar a editar para "re-marcar" la app a
   cualquier giro de negocio.
   ════════════════════════════════════════════════════════════════ */
const BUSINESS_TYPES = {
  restaurante:{ icon:"🍔", name:"Restaurante", cartEnabled:true,
    vocab:{ cartSheetTitle:"Tu pedido", transactionWord:"Pedido", transactionVerb:"Pedido confirmado",
      checkoutCta:"Confirmar pedido", addCta:"Agregar", catalogWord:"Menú", itemWord:"platillo", historyWord:"Pedidos" } },
  barberia:{ icon:"💈", name:"Barbería / Estética", cartEnabled:false,
    vocab:{ cartSheetTitle:"Tu reserva", transactionWord:"Cita", transactionVerb:"Cita confirmada",
      checkoutCta:"Confirmar cita", addCta:"Reservar", catalogWord:"Servicios", itemWord:"servicio", historyWord:"Citas" } },
  veterinaria:{ icon:"🐶", name:"Veterinaria", cartEnabled:false,
    vocab:{ cartSheetTitle:"Tu solicitud", transactionWord:"Cita", transactionVerb:"Cita agendada",
      checkoutCta:"Agendar cita", addCta:"Agendar", catalogWord:"Servicios", itemWord:"servicio", historyWord:"Citas" } },
  gimnasio:{ icon:"🏋", name:"Gimnasio", cartEnabled:false,
    vocab:{ cartSheetTitle:"Tu selección", transactionWord:"Inscripción", transactionVerb:"Inscripción confirmada",
      checkoutCta:"Confirmar inscripción", addCta:"Elegir", catalogWord:"Planes y clases", itemWord:"plan", historyWord:"Actividad" } },
  farmacia:{ icon:"💊", name:"Farmacia", cartEnabled:true,
    vocab:{ cartSheetTitle:"Tu pedido", transactionWord:"Pedido", transactionVerb:"Pedido confirmado",
      checkoutCta:"Confirmar pedido", addCta:"Agregar", catalogWord:"Productos", itemWord:"producto", historyWord:"Compras" } },
  tienda:{ icon:"🛒", name:"Tienda / Retail", cartEnabled:true,
    vocab:{ cartSheetTitle:"Tu compra", transactionWord:"Compra", transactionVerb:"Compra confirmada",
      checkoutCta:"Confirmar compra", addCta:"Agregar", catalogWord:"Catálogo", itemWord:"producto", historyWord:"Compras" } },
  hotel:{ icon:"🏨", name:"Hotel", cartEnabled:false,
    vocab:{ cartSheetTitle:"Tu reserva", transactionWord:"Reserva", transactionVerb:"Reserva confirmada",
      checkoutCta:"Confirmar reserva", addCta:"Reservar", catalogWord:"Habitaciones y experiencias", itemWord:"experiencia", historyWord:"Estancias" } },
  taller:{ icon:"🔧", name:"Taller / Refaccionaria", cartEnabled:true,
    vocab:{ cartSheetTitle:"Tu orden", transactionWord:"Orden de servicio", transactionVerb:"Orden registrada",
      checkoutCta:"Confirmar orden", addCta:"Agregar", catalogWord:"Servicios y refacciones", itemWord:"artículo", historyWord:"Órdenes" } }
};

const APP_CONFIG = {
  businessType:"restaurante",

  business:{
    name:"Nimbus Rewards", slogan:"Tu fidelidad, recompensada.",
    logoText:"N", logoUrl:"",
    address:"Av. Principal 123, Ensenada, BC", phone:"+52 646 000 0000", whatsapp:"526460000000",
    hours:"Lun–Sáb, 9:00–20:00",
    social:{instagram:"@nimbusrewards", facebook:"NimbusRewards", tiktok:"@nimbusrewards"},
    branches:[
      {id:"centro",name:"Sucursal Centro",address:"Av. Principal 123",hours:"9:00–20:00"},
      {id:"norte", name:"Sucursal Norte", address:"Blvd. Norte 456", hours:"10:00–19:00"},
      {id:"plaza", name:"Sucursal Plaza", address:"Plaza Mayor, Local 12", hours:"9:00–21:00"}
    ]
  },

  theme:{
    primary:"#4F46E5", primaryLight:"#6366F1", primaryLighter:"#818CF8",
    secondary:"#0EA5A4", secondaryLight:"#14B8B6",
    accent:"#F59E0B", dark:"#0F1222", dark2:"#181C32",
    fontDisplay:"'Sora',sans-serif", fontBody:"'Inter',sans-serif"
  },

  modules:{ cartEnabled:true, inventoryEnabled:true, branchesEnabled:true, couponsEnabled:true, reviewsEnabled:true },

  labels:{ home:"Inicio", catalog:"Catálogo", rewards:"Recompensas", catalogSingular:"producto o servicio", currency:"$", pointsUnit:"puntos" },

  loyaltyProgram:{
    type:"points", unitNameSingular:"punto", unitNamePlural:"puntos", icon:"⭐", earnRate:0.1,
    levels:[
      {name:"Bronce",  icon:"🥉", minPts:0},
      {name:"Plata",   icon:"🥈", minPts:300},
      {name:"Oro",     icon:"🥇", minPts:800},
      {name:"Platino", icon:"💎", minPts:1500}
    ]
  },

  categories:[
    {id:"destacados", name:"Destacados", icon:"✨"},
    {id:"tecnologia",  name:"Tecnología", icon:"💻"},
    {id:"hogar",       name:"Hogar",      icon:"🏠"},
    {id:"bienestar",   name:"Bienestar",  icon:"🧘"},
    {id:"accesorios",  name:"Accesorios", icon:"🎒"}
  ],

  products:[
    {id:1, sku:"NB-AUR-01", cat:"tecnologia", name:"Audífonos inalámbricos", desc:"Cancelación de ruido, 30h de batería", price:1299, oldPrice:1599, emoji:"🎧", pts:65, tags:["Nuevo"], stock:24, available:true, variants:["Negro","Blanco"]},
    {id:2, sku:"NB-LMP-02", cat:"hogar", name:"Lámpara inteligente", desc:"Control por app, 16 millones de colores", price:549, oldPrice:0, emoji:"💡", pts:27, tags:["Más vendido"], stock:40, available:true, variants:[]},
    {id:3, sku:"NB-YOG-03", cat:"bienestar", name:"Tapete de yoga premium", desc:"Antideslizante, ecológico, 6mm grosor", price:399, oldPrice:499, emoji:"🧘", pts:20, tags:["Favorito"], stock:15, available:true, variants:["Morado","Verde","Gris"]},
    {id:4, sku:"NB-MOC-04", cat:"accesorios", name:"Mochila urbana antirrobo", desc:"Puerto USB, compartimento laptop 15\"", price:899, oldPrice:0, emoji:"🎒", pts:45, tags:[], stock:18, available:true, variants:["Negro","Gris"]},
    {id:5, sku:"NB-REL-05", cat:"tecnologia", name:"Reloj inteligente", desc:"Monitoreo de salud y notificaciones", price:1899, oldPrice:2199, emoji:"⌚", pts:95, tags:["Nuevo","Más vendido"], stock:0, available:false, variants:["Negro","Plata"]},
    {id:6, sku:"NB-VLA-06", cat:"hogar", name:"Vela aromática de soya", desc:"Aroma lavanda, 40h de duración", price:189, oldPrice:0, emoji:"🕯️", pts:9, tags:[], stock:60, available:true, variants:[]},
    {id:7, sku:"NB-BOT-07", cat:"bienestar", name:"Botella térmica 750ml", desc:"Mantiene frío 24h, caliente 12h", price:329, oldPrice:399, emoji:"🍶", pts:16, tags:["Favorito"], stock:33, available:true, variants:["Azul","Negro","Rosa"]},
    {id:8, sku:"NB-CAR-08", cat:"accesorios", name:"Cartera minimalista", desc:"Piel vegana, protección RFID", price:459, oldPrice:0, emoji:"👛", pts:23, tags:[], stock:27, available:true, variants:[]}
  ],

  promotions:[
    {id:1, title:"20% de descuento", desc:"En toda la categoría Tecnología. Aplica del 1 al 31 de este mes.", emoji:"💻", color:"linear-gradient(135deg,#4F46E5,#818CF8)", validity:"Todo el mes", cta:"Ver productos", link:"tecnologia", priority:1, code:"TECH20"},
    {id:2, title:"Puntos dobles hoy", desc:"Toda compra de hoy te da el doble de puntos de lealtad.", emoji:"⭐", color:"linear-gradient(135deg,#0EA5A4,#14B8B6)", validity:"Solo hoy", cta:"Comprar ahora", link:"home", priority:2, code:"DBLPTS"},
    {id:3, title:"Envío gratis", desc:"En compras mayores a $599 en cualquier sucursal o a domicilio.", emoji:"🚚", color:"linear-gradient(135deg,#D97706,#F59E0B)", validity:"Permanente", cta:"Conocer más", link:"catalog", priority:3, code:"ENVIOGRATIS"}
  ],

  redeemableRewards:[
    {id:1, name:"$50 de descuento", cost:250, level:"Bronce", icon:"🎟️", rewardType:"descuento"},
    {id:2, name:"Envío gratis", cost:150, level:"Bronce", icon:"🚚", rewardType:"servicio"},
    {id:3, name:"$150 de descuento", cost:600, level:"Plata", icon:"🎟️", rewardType:"descuento"},
    {id:4, name:"Producto de regalo sorpresa", cost:900, level:"Oro", icon:"🎁", rewardType:"producto"},
    {id:5, name:"$400 de descuento", cost:1500, level:"Platino", icon:"💎", rewardType:"cashback"},
    {id:6, name:"Tarjeta de regalo $200", cost:1000, level:"Oro", icon:"🪪", rewardType:"giftcard"},
    {id:7, name:"Experiencia VIP", cost:1800, level:"Platino", icon:"🌟", rewardType:"experiencia"}
  ],

  rewardTypeLabels:{ producto:"Producto", servicio:"Servicio", descuento:"Descuento", cashback:"Cashback", cupon:"Cupón", giftcard:"Tarjeta de regalo", experiencia:"Experiencia" },

  adminDemo:{
    stats:[
      {label:"Clientes registrados", value:"3,482", delta:"+12% este mes", dir:"up"},
      {label:"Ventas del mes", value:"$184,920", delta:"+8% este mes", dir:"up"},
      {label:"Recompensas entregadas", value:"612", delta:"+5% este mes", dir:"up"},
      {label:"Ticket promedio", value:"$412", delta:"-2% este mes", dir:"down"}
    ],
    salesByMonth:[{label:"Ene",value:112000},{label:"Feb",value:98000},{label:"Mar",value:131000},{label:"Abr",value:124000},{label:"May",value:156000},{label:"Jun",value:184920}],
    customerGrowth:[{label:"Ene",value:2100},{label:"Feb",value:2350},{label:"Mar",value:2600},{label:"Abr",value:2840},{label:"May",value:3120},{label:"Jun",value:3482}],
    funnel:[{label:"Visitas",value:12400},{label:"Catálogo",value:8600},{label:"Carrito",value:3100},{label:"Compra",value:1840}],
    topProducts:[{name:"Reloj inteligente", sold:"312 vendidos", icon:"⌚"},{name:"Audífonos inalámbricos", sold:"288 vendidos", icon:"🎧"},{name:"Mochila urbana antirrobo", sold:"201 vendidos", icon:"🎒"}],
    customers:[{name:"Ana Martínez", level:"Plata", spent:"$4,820", icon:"👩"},{name:"Carlos Ruiz", level:"Oro", spent:"$9,150", icon:"👨"},{name:"Laura G.", level:"Bronce", spent:"$1,240", icon:"👩"},{name:"Miguel A.", level:"Platino", spent:"$15,600", icon:"👨"}],
    users:[{name:"Sofía Vega", role:"Administradora", icon:"🛡️"},{name:"Diego Pérez", role:"Cajero · Sucursal Centro", icon:"💼"},{name:"Renata Cruz", role:"Marketing", icon:"📣"}]
  }
};

let state = {
  customer:{name:"Ana Martínez", email:"ana.martinez@email.com", phone:"+52 646 123 4567"},
  balance:540, darkMode:false, cart:[], deliveryMethod:"pickup",
  branch:APP_CONFIG.business.branches[0].id, couponApplied:null,
  activeCat:"destacados", searchQ:"", histFilter:"compras", starSel:0, adminTab:"stats",
  notifications:[
    {icon:"🎉",title:"¡Ganaste puntos dobles!",text:"Tu compra de hoy generó el doble de puntos de lealtad.",time:"Hace 2h",read:false},
    {icon:"📦",title:"Pedido en camino",text:"Tu pedido #4821 va en camino a tu domicilio.",time:"Ayer",read:false},
    {icon:"🏆",title:"Subiste de nivel",text:"Ahora eres nivel Plata. Desbloqueaste nuevas recompensas.",time:"Hace 3 días",read:true}
  ],
  history:{
    compras:[{icon:"🎧",title:"Audífonos inalámbricos",date:"Hoy, 1:30 PM",pts:"+65"},{icon:"🧘",title:"Tapete de yoga premium",date:"15 jun, 1:00 PM",pts:"+20"}],
    canjes:[{icon:"🎟️",title:"$50 de descuento canjeado",date:"10 jun, 5:10 PM",pts:"-250"}],
    movimientos:[{icon:"⭐",title:"Puntos por compra",date:"Hoy, 1:30 PM",pts:"+65"},{icon:"🎁",title:"Bono de bienvenida",date:"1 jun, 9:00 AM",pts:"+100"}],
    cupones:[{icon:"🏷️",title:"Cupón TECH20 aplicado",date:"Hoy, 1:30 PM",pts:""}],
    referidos:[{icon:"🤝",title:"Referiste a Carlos R.",date:"22 may, 4:00 PM",pts:"+50"}]
  },
  reviews:[
    {name:"Laura G.",stars:5,text:"Excelente experiencia, la app es muy fácil de usar y acumulo puntos rápido.",likes:12,date:"Hace 2 días"},
    {name:"Miguel A.",stars:4,text:"Buen catálogo y las recompensas valen la pena.",likes:5,date:"Hace 5 días"}
  ]
};

function vocab(){ return BUSINESS_TYPES[APP_CONFIG.businessType].vocab; }
function cartOn(){ return APP_CONFIG.modules.cartEnabled; }

function applyTheme(){
  const t = APP_CONFIG.theme;
  const r = document.documentElement.style;
  r.setProperty('--c1',t.primary); r.setProperty('--c1-2',t.primaryLight); r.setProperty('--c1-3',t.primaryLighter);
  r.setProperty('--c2',t.secondary); r.setProperty('--c2-2',t.secondaryLight);
  r.setProperty('--accent',t.accent); r.setProperty('--dk',t.dark); r.setProperty('--dk2',t.dark2);
  r.setProperty('--font-display',t.fontDisplay); r.setProperty('--font-body',t.fontBody);
  document.querySelector('meta[name="theme-color"]').setAttribute('content',t.primary);
}
function renderLogo(){
  const b = APP_CONFIG.business;
  if(b.logoUrl) return `<img src="${b.logoUrl}" alt="${b.name}"/>`;
  return b.logoText || b.name.charAt(0);
}
function applyBusinessInfo(){
  const b = APP_CONFIG.business; const v = vocab();
  document.getElementById('pageTitle').textContent = b.name;
  document.getElementById('appLogo').innerHTML = `<div class="logo-mark">${renderLogo()}</div><span>${b.name}</span>`;
  document.getElementById('navLogo').innerHTML = `<div class="nav-logo-mark">${renderLogo()}</div><span>${b.name}</span>`;
  document.getElementById('navLabelHome').textContent = APP_CONFIG.labels.home;
  document.getElementById('navLabelCatalog').textContent = v.catalogWord;
  document.getElementById('navLabelRewards').textContent = APP_CONFIG.labels.rewards;
  document.getElementById('catalogSectionTitle').textContent = v.catalogWord;
  document.getElementById('cartSheetTitle').textContent = v.cartSheetTitle;
  document.getElementById('adminBannerText').textContent = `Administra clientes, ${v.itemWord}s, promociones, recompensas y la apariencia de tu app — sin tocar código.`;
}
function getLevel(){ const lv=APP_CONFIG.loyaltyProgram.levels; let cur=lv[0]; for(const l of lv){ if(state.balance>=l.minPts) cur=l; } return cur; }
function getNextLevel(){ const lv=APP_CONFIG.loyaltyProgram.levels; const idx=lv.findIndex(l=>l.name===getLevel().name); return lv[idx+1]||null; }
function updateLoyaltyHeader(){
  const lp=APP_CONFIG.loyaltyProgram; const cur=getLevel(); const next=getNextLevel();
  document.getElementById('lcName').textContent = state.customer.name;
  document.getElementById('lcLevel').textContent = `${cur.icon} ${cur.name}`;
  const balEl = document.getElementById('lcBalance');
  if(balEl.textContent !== state.balance.toLocaleString()){
    balEl.classList.remove('pulse'); void balEl.offsetWidth; balEl.classList.add('pulse');
  }
  balEl.textContent = state.balance.toLocaleString();
  document.getElementById('lcUnitLabel').textContent = `${lp.icon} ${lp.unitNamePlural}`;
  document.getElementById('tbPts').textContent = `${lp.icon} ${state.balance.toLocaleString()}`;
  if(next){
    const span = next.minPts - cur.minPts;
    const prog = Math.min(100,((state.balance - cur.minPts)/span)*100);
    document.getElementById('lcProgFill').style.width = prog+'%';
    document.getElementById('lcProgLabel').textContent = `${next.minPts - state.balance} ${lp.unitNamePlural} para ${next.name}`;
  } else {
    document.getElementById('lcProgFill').style.width = '100%';
    document.getElementById('lcProgLabel').textContent = `Nivel máximo alcanzado`;
  }
}
function renderCatChips(targetId){
  const el = document.getElementById(targetId);
  let html = `<div class="cat-chip ${state.activeCat==='destacados'?'active':''}" onclick="filterCat('destacados')">✨ Destacados</div>`;
  APP_CONFIG.categories.filter(c=>c.id!=='destacados').forEach(c=>{
    html += `<div class="cat-chip ${state.activeCat===c.id?'active':''}" onclick="filterCat('${c.id}')">${c.icon} ${c.name}</div>`;
  });
  el.innerHTML = html;
}
function filterCat(cat){ state.activeCat = cat; renderCatalog(); renderHomeGrid(); }
function filteredProducts(){
  let p = APP_CONFIG.products;
  if(state.activeCat && state.activeCat!=='destacados') p = p.filter(x=>x.cat===state.activeCat);
  if(state.searchQ) p = p.filter(x=>x.name.toLowerCase().includes(state.searchQ.toLowerCase()) || x.desc.toLowerCase().includes(state.searchQ.toLowerCase()));
  return p;
}
function onSearch(v){
  state.searchQ = v;
  document.getElementById('searchInput').value = v;
  document.getElementById('searchInput2').value = v;
  renderCatalog(); renderHomeGrid();
}
function productCardHtml(p){
  const lp = APP_CONFIG.loyaltyProgram;
  const discount = p.oldPrice ? Math.round((1-p.price/p.oldPrice)*100) : 0;
  const showStock = APP_CONFIG.modules.inventoryEnabled;
  return `
  <div class="prod-card" onclick="openProduct(${p.id})">
    <div class="prod-img-wrap">
      ${p.emoji}
      ${p.tags[0] ? `<div class="prod-tag-badge">${p.tags[0]}</div>` : ''}
      ${discount ? `<div class="prod-discount-badge">-${discount}%</div>` : ''}
      ${(showStock && !p.available) ? `<div class="no-stock-badge">No disponible</div>` : `<div class="prod-loy-badge">${lp.icon} +${p.pts}</div>`}
    </div>
    <div class="prod-body">
      <div class="prod-name">${p.name}</div>
      <div class="prod-desc">${p.desc}</div>
      <div class="prod-footer">
        <div class="prod-price-wrap">
          ${p.oldPrice ? `<span class="prod-price-old">${APP_CONFIG.labels.currency}${p.oldPrice}</span>`:''}
          <span class="prod-price">${APP_CONFIG.labels.currency}${p.price}</span>
        </div>
        <button class="add-to-cart" ${(showStock && !p.available)?'disabled':''} onclick="event.stopPropagation();addToCart(${p.id},1,this)">${cartOn()?'+':'✓'}</button>
      </div>
    </div>
  </div>`;
}
function renderCatalog(){
  renderCatChips('catScroll');
  document.getElementById('catalogGrid').innerHTML = filteredProducts().map(productCardHtml).join('') || emptyStateHtml('No encontramos resultados','🔍');
}
function renderHomeGrid(){
  renderCatChips('catScrollHome');
  const items = filteredProducts().slice(0,4);
  document.getElementById('homeGrid').innerHTML = items.map(productCardHtml).join('') || emptyStateHtml('No encontramos resultados','🔍');
}
function emptyStateHtml(msg,icon){ return `<div class="empty-state" style="grid-column:1/-1;"><div class="empty-state-icon">${icon}</div>${msg}</div>`; }

let pdQty = 1, pdSelectedVariant = null, pdCurrentId = null;
function openProduct(id){
  const p = APP_CONFIG.products.find(x=>x.id===id);
  pdQty = 1; pdCurrentId = id; pdSelectedVariant = p.variants[0] || null;
  renderProductDetail(p);
  openOverlay('ovProduct');
}
function renderProductDetail(p){
  const lp = APP_CONFIG.loyaltyProgram; const v = vocab();
  const discount = p.oldPrice ? Math.round((1-p.price/p.oldPrice)*100) : 0;
  const showStock = APP_CONFIG.modules.inventoryEnabled;
  document.getElementById('productDetailBody').innerHTML = `
    <div class="pd-gallery">${p.emoji}</div>
    <div class="pd-body">
      <div class="pd-name">${p.name}</div>
      <div class="pd-sku">SKU: ${p.sku}${showStock? ' · '+(p.available? (p.stock+' disponibles') : 'No disponible') : ''}</div>
      <div class="pd-tags">${p.tags.map(t=>`<span class="pd-tag">${t}</span>`).join('')}</div>
      <div class="pd-price-row">
        <span class="pd-price">${APP_CONFIG.labels.currency}${p.price}</span>
        ${p.oldPrice ? `<span class="pd-price-old">${APP_CONFIG.labels.currency}${p.oldPrice}</span><span style="color:#DC2626;font-weight:800;font-size:13px;">-${discount}%</span>` : ''}
      </div>
      <div class="pd-desc">${p.desc}</div>
      ${p.variants.length ? `<div class="pd-variants"><h4 style="font-size:12px;font-weight:800;color:var(--txt2);margin-bottom:8px;text-transform:uppercase;">Opciones</h4>
        <div class="option-row">${p.variants.map(vv=>`<div class="option-pill ${vv===pdSelectedVariant?'active':''}" onclick="selectVariant('${vv}',this)">${vv}</div>`).join('')}</div></div>` : ''}
      ${cartOn() ? `<div class="pd-qty-row">
        <div style="font-size:13px;font-weight:700;color:var(--txt2);">Cantidad</div>
        <div class="pd-qty-ctrl">
          <button class="pd-qty-btn" onclick="changePdQty(-1)">−</button>
          <span class="qty-num" id="pdQtyVal">${pdQty}</span>
          <button class="pd-qty-btn" onclick="changePdQty(1)">+</button>
        </div>
      </div>` : ''}
      <button class="pd-add-btn" ${(showStock&&!p.available)?'disabled':''} onclick="addToCart(${p.id},pdQty)">
        ${(showStock&&!p.available)? 'No disponible' : `${v.addCta} · ${APP_CONFIG.labels.currency}${p.price*pdQty} · ${lp.icon} +${p.pts*pdQty}`}
      </button>
    </div>`;
}
function selectVariant(v,el){ pdSelectedVariant=v; document.querySelectorAll('.option-pill').forEach(p=>p.classList.remove('active')); el.classList.add('active'); }
function changePdQty(d){ pdQty=Math.max(1,pdQty+d); renderProductDetail(APP_CONFIG.products.find(x=>x.id===pdCurrentId)); }

function addToCart(id,qty,btnEl){
  const p = APP_CONFIG.products.find(x=>x.id===id);
  if(!p || (APP_CONFIG.modules.inventoryEnabled && !p.available)) return;
  if(btnEl){ btnEl.classList.remove('confirmed'); void btnEl.offsetWidth; btnEl.classList.add('confirmed'); }
  if(!cartOn()){
    state.balance += p.pts;
    const v = vocab();
    state.history.compras.unshift({icon:p.emoji,title:p.name,date:'Hoy',pts:`+${p.pts}`});
    updateLoyaltyHeader();
    document.getElementById('successTitle').textContent = v.transactionVerb;
    document.getElementById('successMsg').textContent = `Ganaste ${p.pts} ${APP_CONFIG.loyaltyProgram.unitNamePlural} de lealtad.`;
    closeOverlay('ovProduct');
    openOverlay('ovSuccess');
    setTimeout(()=>launchConfetti(document.getElementById('successRing')),80);
    return;
  }
  const existing = state.cart.find(c=>c.id===id);
  if(existing) existing.qty += qty; else state.cart.push({id, qty});
  updateCartUI();
  toast(`${p.name} agregado`);
  flyToCartFx(btnEl, p.emoji);
  const fab = document.getElementById('cartFab');
  if(fab && fab.style.display!=='none'){ fab.classList.remove('bump'); void fab.offsetWidth; fab.classList.add('bump'); }
}
function flyToCartFx(fromEl, emoji){
  const fab = document.getElementById('cartFab');
  if(!fromEl || !fab || fab.style.display==='none') return;
  const fr = fromEl.getBoundingClientRect(); const to = fab.getBoundingClientRect();
  const span = document.createElement('span');
  span.className = 'fly-badge'; span.textContent = emoji || '🛒';
  const startX = fr.left+fr.width/2-9, startY = fr.top+fr.height/2-9;
  const dx = (to.left+to.width/2) - (fr.left+fr.width/2);
  const dy = (to.top+to.height/2) - (fr.top+fr.height/2);
  span.style.left = startX+'px'; span.style.top = startY+'px';
  span.style.setProperty('--fly-end', `translate(${dx}px,${dy}px)`);
  document.body.appendChild(span);
  setTimeout(()=>span.remove(),650);
}
function changeQty(id,d){
  const it = state.cart.find(c=>c.id===id);
  if(!it) return;
  it.qty += d;
  if(it.qty<=0) state.cart = state.cart.filter(c=>c.id!==id);
  state._justChangedId = id;
  updateCartUI(); showCart();
}
function removeFromCart(id){ state.cart = state.cart.filter(c=>c.id!==id); updateCartUI(); showCart(); }
function cartTotals(){
  let subtotal=0, pts=0;
  state.cart.forEach(c=>{ const p = APP_CONFIG.products.find(x=>x.id===c.id); if(p){ subtotal += p.price*c.qty; pts += p.pts*c.qty; } });
  let discount = state.couponApplied ? Math.round(subtotal*0.1) : 0;
  let shipping = state.deliveryMethod==='delivery' && (subtotal-discount) < 599 ? 59 : 0;
  return {subtotal, discount, shipping, total: subtotal-discount+shipping, pts};
}
function updateCartUI(){
  if(!cartOn()){ document.getElementById('cartFab').style.display='none'; return; }
  const count = state.cart.reduce((a,c)=>a+c.qty,0);
  const badge = document.getElementById('cartBadge');
  if(badge){ badge.style.display = count? 'flex':'none'; badge.textContent = count; }
}
function applyCoupon(){
  const input = document.getElementById('couponInput');
  const code = input.value.trim().toUpperCase();
  const promo = APP_CONFIG.promotions.find(p=>p.code===code);
  if(promo){
    state.couponApplied = code;
    state._couponError = false;
    toast('Cupón aplicado: '+code);
    launchConfetti(input);
  } else {
    state._couponError = true;
    toast('Cupón no válido');
  }
  showCart();
}
function setDelivery(method){ state.deliveryMethod = method; showCart(); }
function setBranch(id){ state.branch = id; showCart(); }
function showCart(){
  if(!cartOn()) return;
  const t = cartTotals(); const lp = APP_CONFIG.loyaltyProgram; const v = vocab();
  document.getElementById('cartSheetTitle').textContent = v.cartSheetTitle;
  let itemsHtml = state.cart.map(c=>{
    const p = APP_CONFIG.products.find(x=>x.id===c.id);
    if(!p) return '';
    return `<div class="cart-item">
      <div class="ci-img">${p.emoji}</div>
      <div class="ci-info">
        <div class="ci-name">${p.name}</div>
        <div class="ci-price">${APP_CONFIG.labels.currency}${p.price*c.qty}</div>
        <div class="ci-pts">${lp.icon} +${p.pts*c.qty} ${lp.unitNamePlural}</div>
        <div class="qty-ctrl">
          <button class="qty-btn" onclick="changeQty(${p.id},-1)">−</button>
          <span class="qty-num ${state._justChangedId===p.id?'bump':''}">${c.qty}</span>
          <button class="qty-btn" onclick="changeQty(${p.id},1)">+</button>
        </div>
      </div>
      <button class="ci-remove" onclick="removeFromCart(${p.id})">🗑️</button>
    </div>`;
  }).join('');
  if(!state.cart.length){ document.getElementById('cartBody').innerHTML = emptyStateHtml('Aún no agregas nada','🛒'); openOverlay('ovCart'); return; }
  document.getElementById('cartBody').innerHTML = `
    ${itemsHtml}
    <div class="cart-section">
      <h4>Método de entrega</h4>
      <div class="option-row">
        <div class="option-pill ${state.deliveryMethod==='pickup'?'active':''}" onclick="setDelivery('pickup')">🏬 Recoger en tienda</div>
        <div class="option-pill ${state.deliveryMethod==='delivery'?'active':''}" onclick="setDelivery('delivery')">🚚 A domicilio</div>
      </div>
    </div>
    ${APP_CONFIG.modules.branchesEnabled ? `<div class="cart-section">
      <h4>Sucursal</h4>
      <div class="option-row">${APP_CONFIG.business.branches.map(b=>`<div class="option-pill ${state.branch===b.id?'active':''}" onclick="setBranch('${b.id}')">${b.name}</div>`).join('')}</div>
    </div>` : ''}
    ${APP_CONFIG.modules.couponsEnabled ? `<div class="cart-section">
      <h4>Cupón</h4>
      <div class="coupon-row"><input id="couponInput" placeholder="Código de cupón" value="${state.couponApplied||''}" class="${state.couponApplied?'applied-ok':''} ${state._couponError?'shake-err':''}"/><button class="${state.couponApplied?'applied':''}" onclick="applyCoupon()">${state.couponApplied?'✓ Aplicado':'Aplicar'}</button></div>
    </div>` : ''}
    <div class="cart-section"><h4>Notas</h4><textarea class="c-input" rows="2" placeholder="Instrucciones especiales (opcional)"></textarea></div>
    <div class="cart-section">
      <div class="cart-summary-row"><span>Subtotal</span><span>${APP_CONFIG.labels.currency}${t.subtotal}</span></div>
      ${t.discount? `<div class="cart-summary-row"><span>Cupón</span><span>-${APP_CONFIG.labels.currency}${t.discount}</span></div>`:''}
      <div class="cart-summary-row"><span>Envío</span><span>${t.shipping? APP_CONFIG.labels.currency+t.shipping : 'Gratis'}</span></div>
      <div class="cart-summary-row total"><span>Total</span><span>${APP_CONFIG.labels.currency}${t.total}</span></div>
      <div class="cart-summary-row" style="color:var(--warn);"><span>Ganarás</span><span>${lp.icon} +${t.pts} ${lp.unitNamePlural}</span></div>
    </div>
    <button class="checkout-btn" onclick="checkout()">${v.checkoutCta}</button>
  `;
  openOverlay('ovCart');
  state._justChangedId = null;
  state._couponError = false;
}
function checkout(){
  const t = cartTotals(); const v = vocab();
  state.balance += t.pts;
  state.history.compras.unshift({icon:'🛍️',title:`${v.transactionWord} (${state.cart.length} ${v.itemWord}${state.cart.length>1?'s':''})`,date:'Hoy',pts:`+${t.pts}`});
  state.cart = []; state.couponApplied = null;
  updateCartUI(); updateLoyaltyHeader();
  closeOverlay('ovCart');
  document.getElementById('successTitle').textContent = v.transactionVerb;
  document.getElementById('successMsg').textContent = `Ganaste ${t.pts} ${APP_CONFIG.loyaltyProgram.unitNamePlural} de lealtad.`;
  openOverlay('ovSuccess');
  setTimeout(()=>launchConfetti(document.getElementById('successRing')),80);
}
function renderPromos(){
  document.getElementById('promoScroll').innerHTML = APP_CONFIG.promotions.sort((a,b)=>a.priority-b.priority).map(p=>`
    <div class="promo-card" style="background:${p.color}" onclick="goPromoLink('${p.link}')">
      <div class="promo-emoji-bg">${p.emoji}</div>
      <div class="promo-title">${p.title}</div>
      <div class="promo-desc">${p.desc}</div>
      <div class="promo-cta">${p.cta} →</div>
    </div>`).join('');
}
function goPromoLink(link){
  if(link==='home'){ showTab('home'); return; }
  if(link==='catalog'){ showTab('catalog'); return; }
  state.activeCat = link; showTab('catalog'); renderCatalog();
}
function renderLevels(){
  const cur = getLevel();
  document.getElementById('levelsWrap').innerHTML = APP_CONFIG.loyaltyProgram.levels.map(l=>`
    <div class="level-card ${l.name===cur.name?'current':''}">
      <div class="level-card-icon">${l.icon}</div>
      <div class="level-card-name">${l.name}</div>
      <div class="level-card-pts">${l.minPts}+ ${APP_CONFIG.loyaltyProgram.unitNamePlural}</div>
    </div>`).join('');
}
function renderRedeem(){
  const lp = APP_CONFIG.loyaltyProgram;
  document.getElementById('redeemList').innerHTML = APP_CONFIG.redeemableRewards.map(r=>`
    <div class="redeem-list-item">
      <div class="redeem-icon">${r.icon}</div>
      <div class="redeem-info">
        <div class="redeem-name">${r.name}</div>
        <div class="redeem-cost">${lp.icon} ${r.cost} ${lp.unitNamePlural} · Nivel ${r.level}</div>
        <span class="redeem-type-tag">${APP_CONFIG.rewardTypeLabels[r.rewardType]||r.rewardType}</span>
      </div>
      <button class="redeem-btn" ${state.balance<r.cost?'disabled':''} onclick="doRedeem('${r.name.replace(/'/g,"\\'")}',${r.cost})">Canjear</button>
    </div>`).join('');
}
function doRedeem(name,cost){
  if(state.balance<cost){
    toast('No tienes suficientes '+APP_CONFIG.loyaltyProgram.unitNamePlural);
    return;
  }
  state.balance -= cost;
  state.history.canjes.unshift({icon:'🎟️',title:name+' canjeado',date:'Hoy',pts:`-${cost}`});
  updateLoyaltyHeader(); renderRedeem();
  toast('¡Canje exitoso! '+name);
  launchConfetti();
}
/* pequeño confeti para momentos de éxito, funciona con o sin overlay abierto */
function launchConfetti(targetEl){
  let originRect;
  if(targetEl && targetEl.offsetParent !== null){
    originRect = targetEl.getBoundingClientRect();
  } else {
    originRect = {left:window.innerWidth/2-3, top:Math.min(160,window.innerHeight*.25), width:6, height:6};
  }
  const colors = ['#F59E0B','#4F46E5','#0EA5A4','#EF4444','#10B981'];
  for(let i=0;i<14;i++){
    const dot = document.createElement('span');
    dot.className = 'confetti-dot';
    dot.style.position = 'fixed';
    dot.style.zIndex = '950';
    dot.style.background = colors[i%colors.length];
    dot.style.left = (originRect.left+originRect.width/2)+'px';
    dot.style.top = (originRect.top+originRect.height/2)+'px';
    const angle = (Math.PI*2*i)/14 + Math.random()*.5;
    const dist = 60+Math.random()*50;
    dot.style.setProperty('--conf-end', `translate(${Math.cos(angle)*dist}px,${Math.sin(angle)*dist}px)`);
    dot.style.animationDelay = (Math.random()*.15)+'s';
    document.body.appendChild(dot);
    setTimeout(()=>dot.remove(),1000);
  }
}
function renderHistTabs(){
  const v = vocab();
  const tabs = [['compras',v.historyWord],['canjes','Canjes'],['movimientos','Movimientos'],['cupones','Cupones'],['referidos','Referidos']];
  document.getElementById('histTabs').innerHTML = tabs.map(([k,l])=>`<div class="hist-tab ${state.histFilter===k?'active':''}" onclick="setHistFilter('${k}')">${l}</div>`).join('');
}
function setHistFilter(k){ state.histFilter=k; renderHistory(); }
function renderHistory(){
  renderHistTabs();
  const items = state.history[state.histFilter] || [];
  document.getElementById('histList').innerHTML = items.map(h=>`
    <div class="hist-item">
      <div class="hist-icon">${h.icon}</div>
      <div class="hist-info"><div class="hist-title">${h.title}</div><div class="hist-date">${h.date}</div></div>
      ${h.pts? `<div class="hist-pts ${h.pts.startsWith('+')?'pos':'neg'}">${h.pts}</div>` : ''}
    </div>`).join('') || emptyStateHtml('Sin movimientos en esta categoría','📭');
}
function showNotifications(){
  document.getElementById('notifBody').innerHTML = state.notifications.map((n,i)=>`
    <div class="notif-item ${n.read?'':'unread'}" onclick="markRead(${i})">
      <div class="notif-icon">${n.icon}</div>
      <div class="notif-body"><div class="notif-title">${n.title}</div><div class="notif-text">${n.text}</div><div class="notif-time">${n.time}</div></div>
      ${!n.read? '<div class="notif-dot"></div>':''}
    </div>`).join('') || emptyStateHtml('No tienes notificaciones','🔕');
  openOverlay('ovNotif');
  document.querySelectorAll('.icon-btn').forEach(b=>{
    if(b.innerHTML.includes('🔔')){ b.classList.remove('bell-shake'); void b.offsetWidth; b.classList.add('bell-shake'); }
  });
}
function markRead(i){ state.notifications[i].read=true; showNotifications(); updateNotifDot(); }
function updateNotifDot(){
  const has = state.notifications.some(n=>!n.read);
  document.getElementById('notifDot').style.display = has?'block':'none';
  document.getElementById('tbNotifDot').style.display = has?'block':'none';
}
function renderStarInput(){
  document.getElementById('starInput').innerHTML = [1,2,3,4,5].map(n=>`<span class="star-btn ${n<=state.starSel?'on':''}" onclick="setStar(${n})">★</span>`).join('');
}
function setStar(n){ state.starSel=n; renderStarInput(); }
function renderReviews(){
  document.getElementById('reviewsList').innerHTML = state.reviews.map((r,i)=>`
    <div class="review-card">
      <div class="review-header">
        <div class="review-avatar">${r.name.charAt(0)}</div>
        <div class="review-meta"><div class="review-name">${r.name}</div><div class="review-date">${r.date}</div></div>
        <div class="review-stars">${'★'.repeat(r.stars)}${'☆'.repeat(5-r.stars)}</div>
      </div>
      <div class="review-text">${r.text}</div>
      <div class="review-likes" onclick="likeReview(${i})">👍 ${r.likes} útil</div>
    </div>`).join('');
}
function likeReview(i){ state.reviews[i].likes++; renderReviews(); }
function submitReview(){
  const text = document.getElementById('reviewText').value.trim();
  if(!text || !state.starSel){ toast('Agrega una calificación y comentario'); return; }
  state.reviews.unshift({name:state.customer.name, stars:state.starSel, text, likes:0, date:'Ahora'});
  document.getElementById('reviewText').value=''; state.starSel=0;
  renderStarInput(); renderReviews();
  toast('¡Gracias por tu opinión!');
}
function renderProfile(){
  const b = APP_CONFIG.business;
  document.getElementById('profAvatar').textContent = state.customer.name.charAt(0);
  document.getElementById('profName').textContent = state.customer.name;
  document.getElementById('profSub').textContent = state.customer.email;
  document.getElementById('profileList').innerHTML = `
    <div class="profile-group">
      <div class="profile-group-title">Datos personales</div>
      <div class="profile-row" onclick="openAccountForm('edit')"><div class="profile-row-icon">👤</div><div class="profile-row-txt">Nombre<div class="profile-row-sub">${state.customer.name}</div></div><div class="profile-row-arrow">›</div></div>
      <div class="profile-row" onclick="openAccountForm('edit')"><div class="profile-row-icon">✉️</div><div class="profile-row-txt">Correo<div class="profile-row-sub">${state.customer.email}</div></div><div class="profile-row-arrow">›</div></div>
      <div class="profile-row" onclick="openAccountForm('edit')"><div class="profile-row-icon">📱</div><div class="profile-row-txt">Teléfono<div class="profile-row-sub">${state.customer.phone}</div></div><div class="profile-row-arrow">›</div></div>
    </div>
    <div class="profile-group">
      <div class="profile-group-title">Preferencias</div>
      <div class="profile-row" onclick="toast('Muy pronto más idiomas disponibles 🌐')"><div class="profile-row-icon">🌐</div><div class="profile-row-txt">Idioma<div class="profile-row-sub">Español</div></div><div class="profile-row-arrow">›</div></div>
      <div class="profile-row" onclick="showNotifications()"><div class="profile-row-icon">🔔</div><div class="profile-row-txt">Notificaciones</div><div class="profile-row-arrow">›</div></div>
      <div class="profile-row" onclick="toast('Tus datos están protegidos y encriptados 🔒')"><div class="profile-row-icon">🔒</div><div class="profile-row-txt">Privacidad</div><div class="profile-row-arrow">›</div></div>
      <div class="profile-row" onclick="toast('Tu cuenta tiene verificación activa 🛡️')"><div class="profile-row-icon">🛡️</div><div class="profile-row-txt">Seguridad</div><div class="profile-row-arrow">›</div></div>
    </div>
    <div class="profile-group">
      <div class="profile-group-title">Negocio</div>
      <div class="profile-row" onclick="showBranches()"><div class="profile-row-icon">🏬</div><div class="profile-row-txt">Sucursales<div class="profile-row-sub">${b.branches.length} ubicaciones</div></div><div class="profile-row-arrow">›</div></div>
      <div class="profile-row" onclick="contactWhatsApp()"><div class="profile-row-icon">💬</div><div class="profile-row-txt">Contactar por WhatsApp</div><div class="profile-row-arrow">›</div></div>
    </div>
    <div class="profile-group">
      <div class="profile-row" style="border-bottom:none;" onclick="confirmLogout()"><div class="profile-row-icon">↪️</div><div class="profile-row-txt">Cerrar sesión</div></div>
      <div class="profile-row danger" style="border-bottom:none;" onclick="confirmDeleteAccount()"><div class="profile-row-icon">🗑️</div><div class="profile-row-txt">Eliminar cuenta</div></div>
    </div>
  `;
}

/* ─── WhatsApp ─── */
function contactWhatsApp(){
  const b = APP_CONFIG.business;
  if(!b.whatsapp){ toast('Este negocio no configuró WhatsApp'); return; }
  const msg = encodeURIComponent(`Hola ${b.name}, tengo una pregunta sobre mi cuenta de lealtad (${state.customer.name}).`);
  window.open(`https://wa.me/${b.whatsapp}?text=${msg}`,'_blank');
  toast('Abriendo WhatsApp… 💬');
}

/* ─── Sucursales ─── */
function showBranches(){
  const b = APP_CONFIG.business;
  document.getElementById('branchesBody').innerHTML = b.branches.map(br=>`
    <div class="admin-list-row" style="cursor:pointer;" onclick="window.open('https://wa.me/${b.whatsapp}','_blank')">
      <div class="admin-list-icon">🏬</div>
      <div class="admin-list-info"><div class="admin-list-title">${br.name}</div><div class="admin-list-sub">${br.address} · ${br.hours}</div></div>
      <span class="admin-tag">Abierta</span>
    </div>`).join('');
  openOverlay('ovBranches');
}

/* ─── Confirmación genérica ─── */
function openConfirm({icon,title,msg,btnLabel,danger,onConfirm}){
  document.getElementById('confirmIcon').textContent = icon;
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').textContent = msg;
  const btn = document.getElementById('confirmBtn');
  btn.textContent = btnLabel;
  btn.className = 'redeem-btn' + (danger?' danger-btn':'');
  btn.onclick = ()=>{ closeOverlay('ovConfirm'); onConfirm(); };
  openOverlay('ovConfirm');
}

/* ─── Cerrar sesión ─── */
function confirmLogout(){
  openConfirm({
    icon:'↪️', title:'¿Cerrar sesión?',
    msg:'Volverás a la pantalla de acceso. Podrás entrar de nuevo cuando quieras.',
    btnLabel:'Cerrar sesión', danger:false,
    onConfirm:()=>{
      toast('Sesión cerrada 👋');
      setTimeout(()=>openAccountForm('new'),450);
    }
  });
}

/* ─── Eliminar cuenta ─── */
function confirmDeleteAccount(){
  openConfirm({
    icon:'🗑️', title:'¿Eliminar tu cuenta?',
    msg:'Se borrarán tu historial, tus puntos y tus recompensas guardadas. Esta acción no se puede deshacer.',
    btnLabel:'Eliminar cuenta', danger:true,
    onConfirm:()=>{
      state.customer = {name:'',email:'',phone:''};
      state.balance = 0; state.cart = []; state.couponApplied = null;
      state.history = {compras:[],canjes:[],movimientos:[],cupones:[],referidos:[]};
      state.notifications = [];
      updateLoyaltyHeader(); renderHistory(); updateNotifDot();
      toast('Cuenta eliminada 🗑️');
      setTimeout(()=>openAccountForm('new'),450);
    }
  });
}

/* ─── Editar perfil / crear cuenta nueva ─── */
function openAccountForm(mode){
  state._accFormMode = mode;
  const isNew = mode==='new';
  document.getElementById('accFormTitle').textContent = isNew? 'Crea tu nueva cuenta' : 'Editar datos personales';
  document.getElementById('accFormBtn').textContent = isNew? 'Crear cuenta' : 'Guardar cambios';
  document.getElementById('accName').value = isNew? '' : state.customer.name;
  document.getElementById('accEmail').value = isNew? '' : state.customer.email;
  document.getElementById('accPhone').value = isNew? '' : state.customer.phone;
  openOverlay('ovAccountForm');
}
function saveAccountForm(){
  const name = document.getElementById('accName').value.trim();
  const email = document.getElementById('accEmail').value.trim();
  const phone = document.getElementById('accPhone').value.trim();
  const sheet = document.querySelector('#ovAccountForm .sheet');
  if(!name || !email || !email.includes('@')){
    sheet.classList.remove('form-error'); void sheet.offsetWidth; sheet.classList.add('form-error');
    toast('Completa tu nombre y un correo válido');
    return;
  }
  if(state._accFormMode==='new'){
    state.customer = {name, email, phone: phone||'—'};
    state.balance = 100; state.cart = []; state.couponApplied = null;
    state.history = {compras:[],canjes:[],movimientos:[{icon:'🎁',title:'Bono de bienvenida',date:'Ahora',pts:'+100'}],cupones:[],referidos:[]};
    state.notifications = [{icon:'👋',title:'¡Bienvenido/a!',text:`Hola ${name}, tu nueva cuenta está lista y ya tienes 100 puntos de regalo.`,time:'Ahora',read:false}];
    closeOverlay('ovAccountForm');
    updateLoyaltyHeader(); renderProfile(); renderHistory(); updateNotifDot();
    document.querySelector('.pts-big').classList.add('pulse');
    toast('¡Cuenta creada con éxito! 🎉');
    showTab('home');
  } else {
    state.customer = {name, email, phone: phone||state.customer.phone};
    closeOverlay('ovAccountForm');
    updateLoyaltyHeader(); renderProfile();
    toast('Perfil actualizado ✅');
  }
}

const ADMIN_TABS = [
  {id:'stats', name:'Estadísticas', icon:'📊'},{id:'products', name:'Catálogo', icon:'🗂️'},
  {id:'customers', name:'Clientes', icon:'👥'},{id:'promos', name:'Promociones', icon:'🏷️'},
  {id:'rewards', name:'Recompensas', icon:'🎁'},{id:'branches', name:'Sucursales', icon:'🏬'},
  {id:'users', name:'Usuarios', icon:'🧑‍💼'},{id:'theme', name:'Apariencia', icon:'🎨'},{id:'settings', name:'Configuración', icon:'⚙️'}
];
function renderAdminTabs(){
  document.getElementById('adminTabs').innerHTML = ADMIN_TABS.map(t=>`<div class="admin-tab ${state.adminTab===t.id?'active':''}" onclick="setAdminTab('${t.id}')">${t.icon} ${t.name}</div>`).join('');
}
function setAdminTab(id){ state.adminTab=id; renderAdminPanels(); }
function barChartSvg(data,color){
  const w=280,h=120,pad=4,max=Math.max(...data.map(d=>d.value))*1.1;
  const bw=(w-pad*(data.length+1))/data.length;
  const bars=data.map((d,i)=>{
    const bh=(d.value/max)*(h-22); const x=pad+i*(bw+pad), y=h-22-bh;
    return `<rect class="chart-bar" style="animation-delay:${(i*0.06).toFixed(2)}s" x="${x}" y="${y}" width="${bw}" height="${bh}" rx="4" fill="${color}"/><text x="${x+bw/2}" y="${h-8}" font-size="9" fill="var(--txt3)" text-anchor="middle">${d.label}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:120px;">${bars}</svg>`;
}
function lineChartSvg(data,color){
  const w=280,h=120,pad=10,max=Math.max(...data.map(d=>d.value))*1.1,min=Math.min(...data.map(d=>d.value))*0.9;
  const stepX=(w-pad*2)/(data.length-1);
  const pts=data.map((d,i)=>{ const x=pad+i*stepX, y=h-22-((d.value-min)/(max-min))*(h-32); return `${x},${y}`; }).join(' ');
  const labels=data.map((d,i)=>`<text x="${pad+i*stepX}" y="${h-6}" font-size="9" fill="var(--txt3)" text-anchor="middle">${d.label}</text>`).join('');
  const dots=data.map((d,i)=>{ const x=pad+i*stepX, y=h-22-((d.value-min)/(max-min))*(h-32); return `<circle class="chart-dot" style="animation-delay:${(1.0+i*0.05).toFixed(2)}s" cx="${x}" cy="${y}" r="2.6" fill="${color}"/>`; }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:120px;"><polyline class="chart-line" points="${pts}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>${dots}${labels}</svg>`;
}
function renderAdminPanels(){
  renderAdminTabs();
  const d = APP_CONFIG.adminDemo;
  const wrap = document.getElementById('adminPanels');
  let html = '';
  if(state.adminTab==='stats'){
    html += `<div class="stats-grid">${d.stats.map(s=>`<div class="stat-card"><div class="stat-card-label">${s.label}</div><div class="stat-card-value">${s.value}</div><div class="stat-card-delta ${s.dir}">${s.delta}</div></div>`).join('')}</div>`;
    html += `<div class="chart-card"><h4>Ventas por mes</h4>${barChartSvg(d.salesByMonth,'var(--c1)')}</div>`;
    html += `<div class="chart-card"><h4>Crecimiento de clientes</h4>${lineChartSvg(d.customerGrowth,'var(--c2)')}</div>`;
    const maxF = d.funnel[0].value;
    html += `<div class="chart-card"><h4>Embudo de conversión</h4>${d.funnel.map(f=>`<div class="funnel-row"><div class="funnel-label">${f.label}</div><div class="funnel-bar" style="width:${(f.value/maxF*100).toFixed(0)}%;">${f.value.toLocaleString()}</div></div>`).join('')}</div>`;
    html += `<div class="admin-section-title">Productos / servicios más vendidos</div>`;
    html += d.topProducts.map(p=>`<div class="admin-list-row"><div class="admin-list-icon">${p.icon}</div><div class="admin-list-info"><div class="admin-list-title">${p.name}</div><div class="admin-list-sub">${p.sold}</div></div></div>`).join('');
  } else if(state.adminTab==='products'){
    html += `<div class="admin-section-title">${vocab().catalogWord} (${APP_CONFIG.products.length})</div>`;
    html += APP_CONFIG.products.map(p=>`<div class="admin-list-row"><div class="admin-list-icon">${p.emoji}</div><div class="admin-list-info"><div class="admin-list-title">${p.name}</div><div class="admin-list-sub">SKU ${p.sku} · ${p.stock} en existencia</div></div><div class="admin-list-val">${APP_CONFIG.labels.currency}${p.price}</div><span class="admin-tag ${p.available?'':'off'}">${p.available?'Activo':'Pausado'}</span></div>`).join('');
  } else if(state.adminTab==='customers'){
    html += `<div class="admin-section-title">Clientes (${APP_CONFIG.adminDemo.stats[0].value})</div>`;
    html += d.customers.map(c=>`<div class="admin-list-row"><div class="admin-list-icon">${c.icon}</div><div class="admin-list-info"><div class="admin-list-title">${c.name}</div><div class="admin-list-sub">Nivel ${c.level}</div></div><div class="admin-list-val">${c.spent}</div></div>`).join('');
  } else if(state.adminTab==='promos'){
    html += `<div class="admin-section-title">Promociones activas</div>`;
    html += APP_CONFIG.promotions.map(p=>`<div class="admin-list-row"><div class="admin-list-icon">${p.emoji}</div><div class="admin-list-info"><div class="admin-list-title">${p.title}</div><div class="admin-list-sub">${p.validity} · código ${p.code}</div></div><span class="admin-tag">Activa</span></div>`).join('');
  } else if(state.adminTab==='rewards'){
    html += `<div class="admin-section-title">Recompensas configuradas</div>`;
    html += APP_CONFIG.redeemableRewards.map(r=>`<div class="admin-list-row"><div class="admin-list-icon">${r.icon}</div><div class="admin-list-info"><div class="admin-list-title">${r.name}</div><div class="admin-list-sub">${APP_CONFIG.rewardTypeLabels[r.rewardType]} · Nivel ${r.level}</div></div><div class="admin-list-val">${r.cost} pts</div></div>`).join('');
  } else if(state.adminTab==='branches'){
    html += `<div class="admin-section-title">Sucursales</div>`;
    html += APP_CONFIG.business.branches.map(b=>`<div class="admin-list-row"><div class="admin-list-icon">🏬</div><div class="admin-list-info"><div class="admin-list-title">${b.name}</div><div class="admin-list-sub">${b.address} · ${b.hours}</div></div><span class="admin-tag">Abierta</span></div>`).join('');
  } else if(state.adminTab==='users'){
    html += `<div class="admin-section-title">Usuarios del panel</div>`;
    html += d.users.map(u=>`<div class="admin-list-row"><div class="admin-list-icon">${u.icon}</div><div class="admin-list-info"><div class="admin-list-title">${u.name}</div><div class="admin-list-sub">${u.role}</div></div></div>`).join('');
  } else if(state.adminTab==='theme'){
    html += `<div class="admin-section-title">Theme builder</div>`;
    html += `<div class="profile-group">
      <div class="tb-row"><div class="tb-row-label">Color primario</div><input type="color" value="${APP_CONFIG.theme.primary}" onchange="updateTheme('primary',this.value)"/></div>
      <div class="tb-row"><div class="tb-row-label">Color secundario</div><input type="color" value="${APP_CONFIG.theme.secondary}" onchange="updateTheme('secondary',this.value)"/></div>
      <div class="tb-row"><div class="tb-row-label">Color de acento</div><input type="color" value="${APP_CONFIG.theme.accent}" onchange="updateTheme('accent',this.value)"/></div>
      <div class="tb-row"><div class="tb-row-label">Color oscuro (header)</div><input type="color" value="${APP_CONFIG.theme.dark}" onchange="updateTheme('dark',this.value)"/></div>
      <div class="tb-row"><div class="tb-row-label">Nombre del negocio</div><input type="text" value="${APP_CONFIG.business.name}" onchange="updateBizName(this.value)"/></div>
      <div class="tb-row"><div class="tb-row-label">Logo (emoji/letra)</div><input type="text" maxlength="2" style="width:50px;text-align:center;" value="${APP_CONFIG.business.logoText}" onchange="updateLogoText(this.value)"/></div>
    </div>`;
  } else if(state.adminTab==='settings'){
    html += `<div class="admin-section-title">Tipo de negocio</div>`;
    html += `<div class="profile-group" style="padding:14px 16px;">
      <div style="font-size:12.5px;color:var(--txt2);margin-bottom:10px;">Plantilla activa: <b>${BUSINESS_TYPES[APP_CONFIG.businessType].icon} ${BUSINESS_TYPES[APP_CONFIG.businessType].name}</b></div>
      <button class="redeem-btn" onclick="openOverlay('ovBizType')">Cambiar tipo de negocio</button>
    </div>`;
    html += `<div class="admin-section-title">Módulos</div>`;
    html += `<div class="profile-group">
      <div class="tb-row"><div class="tb-row-label">Carrito / acumulación de items</div><input type="checkbox" ${APP_CONFIG.modules.cartEnabled?'checked':''} onchange="toggleModule('cartEnabled',this.checked)"/></div>
      <div class="tb-row"><div class="tb-row-label">Mostrar inventario / disponibilidad</div><input type="checkbox" ${APP_CONFIG.modules.inventoryEnabled?'checked':''} onchange="toggleModule('inventoryEnabled',this.checked)"/></div>
      <div class="tb-row"><div class="tb-row-label">Sucursales</div><input type="checkbox" ${APP_CONFIG.modules.branchesEnabled?'checked':''} onchange="toggleModule('branchesEnabled',this.checked)"/></div>
      <div class="tb-row"><div class="tb-row-label">Cupones</div><input type="checkbox" ${APP_CONFIG.modules.couponsEnabled?'checked':''} onchange="toggleModule('couponsEnabled',this.checked)"/></div>
      <div class="tb-row"><div class="tb-row-label">Reseñas</div><input type="checkbox" ${APP_CONFIG.modules.reviewsEnabled?'checked':''} onchange="toggleModule('reviewsEnabled',this.checked)"/></div>
    </div>`;
  }
  wrap.innerHTML = html;
}
function updateTheme(key,val){ APP_CONFIG.theme[key] = val; applyTheme(); toast('Color actualizado'); }
function updateBizName(val){ APP_CONFIG.business.name = val || APP_CONFIG.business.name; applyBusinessInfo(); toast('Nombre actualizado'); }
function updateLogoText(val){ APP_CONFIG.business.logoText = val; applyBusinessInfo(); toast('Logo actualizado'); }
function toggleModule(key,val){
  APP_CONFIG.modules[key] = val;
  applyBusinessInfo(); updateCartUI(); renderCatalog(); renderHomeGrid(); renderAdminPanels();
  toast('Configuración guardada'); showTab('admin');
}
function renderBizTypeGrid(){
  document.getElementById('bizTypeGrid').innerHTML = Object.entries(BUSINESS_TYPES).map(([key,b])=>
    `<div class="biztype-card ${APP_CONFIG.businessType===key?'active':''}" onclick="selectBizType('${key}')">
      <div class="biztype-icon">${b.icon}</div><div class="biztype-name">${b.name}</div>
    </div>`).join('');
}
function selectBizType(key){
  APP_CONFIG.businessType = key;
  APP_CONFIG.modules.cartEnabled = BUSINESS_TYPES[key].cartEnabled;
  renderBizTypeGrid(); applyBusinessInfo(); updateCartUI();
  renderCatalog(); renderHomeGrid(); renderRedeem(); renderHistTabs(); renderHistory();
  if(state.adminTab==='settings') renderAdminPanels();
}
function showTab(tab){
  document.querySelectorAll('.section-screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-'+tab).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector(`.nav-btn[data-tab="${tab}"]`).classList.add('active');
  document.getElementById('appContent').scrollTop = 0;
  const fab = document.getElementById('cartFab');
  fab.style.display = (cartOn() && (tab==='home'||tab==='catalog')) ? 'flex' : 'none';
  if(tab==='admin') renderAdminPanels();
}
function toggleDark(){
  state.darkMode=!state.darkMode;
  document.body.classList.toggle('dark-mode',state.darkMode);
  document.querySelectorAll('.dark-toggle').forEach(btn=>{
    btn.classList.remove('spin'); void btn.offsetWidth; btn.classList.add('spin');
    btn.textContent = state.darkMode ? '☀️' : '🌙';
  });
}
function closeOnBg(e,id){ if(e.target===document.getElementById(id)) closeOverlay(id); }
function closeOverlay(id){ document.getElementById(id).classList.remove('open'); }
function openOverlay(id){ document.getElementById(id).classList.add('open'); }
function toast(msg){
  const t=document.getElementById('toast');
  document.getElementById('toastMsg').textContent=msg;
  const oldBar = t.querySelector('.toast-bar'); if(oldBar) oldBar.remove();
  const bar = document.createElement('div'); bar.className='toast-bar'; t.appendChild(bar);
  t.classList.add('show');
  clearTimeout(window._toastT);
  window._toastT=setTimeout(()=>t.classList.remove('show'),2200);
}
/* ─── Ripple universal: feedback táctil sutil en toda la app ─── */
(function(){
  const LIGHT = new Set(['checkout-btn','submit-review','redeem-btn','add-to-cart','icon-btn','dark-toggle','pd-add-btn']);
  const SELECTOR = 'button:not(.cart-fab), .nav-btn, .cat-chip, .admin-tab, .hist-tab, .biztype-card, .option-pill, .level-card, .promo-card, .redeem-list-item, .admin-list-row, .close-btn, .prod-card';
  document.addEventListener('pointerdown', function(e){
    const el = e.target.closest(SELECTOR);
    if(!el || el.disabled) return;
    const rect = el.getBoundingClientRect();
    if(!rect.width || !rect.height) return;
    const size = Math.max(rect.width, rect.height) * 1.15;
    const isLight = [...el.classList].some(c=>LIGHT.has(c));
    const ripple = document.createElement('span');
    ripple.className = 'ripple' + (isLight ? ' rpl-light' : '');
    ripple.style.width = ripple.style.height = size+'px';
    ripple.style.left = (e.clientX - rect.left - size/2)+'px';
    ripple.style.top = (e.clientY - rect.top - size/2)+'px';
    const wasStatic = getComputedStyle(el).position === 'static';
    if(wasStatic) el.style.position = 'relative';
    el.classList.add('rpl-wrap');
    el.appendChild(ripple);
    setTimeout(()=>{
      ripple.remove();
      el.classList.remove('rpl-wrap');
      if(wasStatic) el.style.position = '';
    }, 600);
  }, {passive:true});
})();

function init(){
  applyTheme(); applyBusinessInfo(); updateLoyaltyHeader(); renderPromos();
  renderCatChips('catScrollHome'); renderCatChips('catScroll');
  renderHomeGrid(); renderCatalog(); renderLevels(); renderRedeem(); renderHistory();
  renderProfile(); renderStarInput(); renderReviews(); updateCartUI(); updateNotifDot();
  renderBizTypeGrid(); showTab('home');
}
init();
