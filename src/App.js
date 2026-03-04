import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
  PieChart, Pie, Cell, Sector
} from "recharts";

/* ═══════════════════════════════════════════
   로컬스토리지
═══════════════════════════════════════════ */
const LS_KEY = "nh_pf_v5";
const lsSave = (d) => { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch {} };
const lsLoad = () => { try { const r = localStorage.getItem(LS_KEY); return r ? JSON.parse(r) : null; } catch { return null; } };

/* ═══════════════════════════════════════════
   샘플 데이터  (국장 + 미장 혼합)
═══════════════════════════════════════════ */
const SAMPLE = [
  { id:1,  name:"삼성전자",   ticker:"005930", market:"KR", currentPrice:74500,
    trades:[{date:"2024-08-01",type:"buy",qty:30,price:72000},{date:"2024-10-15",type:"buy",qty:20,price:62000},{date:"2025-01-10",type:"sell",qty:10,price:68000}],
    priceHistory:[{date:"10월",price:63500},{date:"11월",price:65000},{date:"12월",price:66800},{date:"1월",price:68200},{date:"2월",price:71000},{date:"3월",price:74500}] },
  { id:2,  name:"SK하이닉스", ticker:"000660", market:"KR", currentPrice:195000,
    trades:[{date:"2024-09-05",type:"buy",qty:15,price:165000},{date:"2025-01-20",type:"buy",qty:5,price:180000}],
    priceHistory:[{date:"10월",price:170000},{date:"11월",price:175000},{date:"12월",price:178000},{date:"1월",price:182000},{date:"2월",price:189000},{date:"3월",price:195000}] },
  { id:3,  name:"NVIDIA",     ticker:"NVDA",   market:"US", currentPrice:875.50,
    trades:[{date:"2024-07-10",type:"buy",qty:5,price:780.00},{date:"2024-11-20",type:"buy",qty:3,price:820.00}],
    priceHistory:[{date:"Oct",price:740},{date:"Nov",price:820},{date:"Dec",price:856},{date:"Jan",price:862},{date:"Feb",price:849},{date:"Mar",price:875.5}] },
  { id:4,  name:"Apple",      ticker:"AAPL",   market:"US", currentPrice:213.20,
    trades:[{date:"2024-08-15",type:"buy",qty:10,price:195.00},{date:"2024-12-01",type:"buy",qty:5,price:208.00}],
    priceHistory:[{date:"Oct",price:199},{date:"Nov",price:205},{date:"Dec",price:208},{date:"Jan",price:210},{date:"Feb",price:209},{date:"Mar",price:213.2}] },
  { id:5,  name:"현대차",     ticker:"005380", market:"KR", currentPrice:258000,
    trades:[{date:"2024-07-20",type:"buy",qty:20,price:235000},{date:"2024-11-01",type:"sell",qty:5,price:248000}],
    priceHistory:[{date:"10월",price:242000},{date:"11월",price:248000},{date:"12월",price:245000},{date:"1월",price:251000},{date:"2월",price:254000},{date:"3월",price:258000}] },
  { id:6,  name:"Tesla",      ticker:"TSLA",   market:"US", currentPrice:248.00,
    trades:[{date:"2024-09-01",type:"buy",qty:8,price:210.00},{date:"2025-01-15",type:"sell",qty:3,price:380.00}],
    priceHistory:[{date:"Oct",price:220},{date:"Nov",price:310},{date:"Dec",price:370},{date:"Jan",price:380},{date:"Feb",price:330},{date:"Mar",price:248}] },
];

const DEFAULT_USD_KRW = 1370; // 기본 환율

/* ═══════════════════════════════════════════
   계산 헬퍼
═══════════════════════════════════════════ */
// stock 단위 그대로 계산 (KR=원, US=달러)
function calcRaw(stock) {
  let qty = 0, cost = 0;
  for (const t of stock.trades) {
    if (t.type === "buy") { cost += t.qty * t.price; qty += t.qty; }
    else { if (qty > 0) { cost -= (cost / qty) * t.qty; } qty -= t.qty; }
  }
  if (qty < 0) qty = 0;
  const avgPrice = qty > 0 ? cost / qty : 0;
  const value    = stock.currentPrice * qty;
  const profit   = value - cost;
  const ret      = cost > 0 ? (profit / cost) * 100 : 0;
  return { qty, avgPrice, cost, value, profit, ret };
}

// 원화 환산 포함
function calcKRW(stock, usdKrw) {
  const raw = calcRaw(stock);
  const fx  = stock.market === "US" ? usdKrw : 1;
  return {
    ...raw,
    valueKRW:   raw.value   * fx,
    costKRW:    raw.cost    * fx,
    profitKRW:  raw.profit  * fx,
    avgPriceKRW: raw.avgPrice * fx,
    currentPriceKRW: stock.currentPrice * fx,
    fx,
  };
}

function buildHistory(stocks, n, usdKrw) {
  const allDates = stocks.flatMap(s => s.priceHistory.map(h => h.date));
  const uniq = [...new Set(allDates)];
  const dates = uniq.slice(-n);
  return dates.map(date => {
    let total = 0;
    for (const s of stocks) {
      const ph  = s.priceHistory.find(h => h.date === date);
      const px  = ph ? ph.price : s.currentPrice;
      const fx  = s.market === "US" ? usdKrw : 1;
      total += px * calcRaw(s).qty * fx;
    }
    return { date, value: total };
  });
}

const fmt    = (n) => Math.round(n).toLocaleString("ko-KR");
const fmtUS  = (n) => Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,",");
const fmtW   = (n) => { const a=Math.abs(n); if(a>=100000000) return (n/100000000).toFixed(1)+"억"; if(a>=10000) return Math.round(n/10000)+"만"; return fmt(n); };
const fmtPx  = (stock, price) => stock.market === "US" ? `$${fmtUS(price)}` : `₩${fmt(price)}`;

/* ═══════════════════════════════════════════
   파이차트 활성 섹터
═══════════════════════════════════════════ */
const renderActiveShape = (props) => {
  const { cx,cy,innerRadius,outerRadius,startAngle,endAngle,fill,payload,percent,value } = props;
  return (
    <g>
      <text x={cx} y={cy-18} textAnchor="middle" fill="#F0F2FF" fontSize={14} fontWeight={700}>{payload.name}</text>
      <text x={cx} y={cy+4}  textAnchor="middle" fill="#FFD300" fontSize={13} fontWeight={700}>₩{fmtW(value)}</text>
      <text x={cx} y={cy+22} textAnchor="middle" fill="#556070" fontSize={11}>{(percent*100).toFixed(1)}%</text>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius+8} startAngle={startAngle} endAngle={endAngle} fill={fill}/>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius-3} outerRadius={innerRadius-1} startAngle={startAngle} endAngle={endAngle} fill={fill}/>
    </g>
  );
};

/* ═══════════════════════════════════════════
   색상 / 상수
═══════════════════════════════════════════ */
const PIE_COLORS = ["#FFD300","#34D399","#60A5FA","#F87171","#A78BFA","#FB923C","#38BDF8","#4ADE80","#F472B6","#FBBF24"];
const hue = (id) => (id*53)%360;
const RANGE = [{label:"1M",n:2},{label:"3M",n:3},{label:"6M",n:6}];
const SORT  = [{key:"value",label:"평가액순"},{key:"return",label:"수익률순"},{key:"profit",label:"손익순"},{key:"name",label:"이름순"}];
const TABS      = ["홈","비중","AI분석","종목관리","API"];
const TAB_ICONS_SVG = ["홈","비중","AI","관리","API"]; // fallback text

const QUICK_Q = [
  "전체 포트폴리오 종합 진단해줘",
  "지금 매도할 종목 있어?",
  "추가 매수 추천은?",
  "텐배거 가능성 분석해줘",
  "룰브레이커 종목 찾아줘",
  "리스크 높은 종목은?",
];

/* ═══════════════════════════════════════════
   AI API 호출
═══════════════════════════════════════════ */
async function callAI(userMsg, systemPrompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role:"user", content: userMsg }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  return data.content?.map(b => b.text||"").join("") || "응답 없음";
}

/* ═══════════════════════════════════════════
   툴팁
═══════════════════════════════════════════ */
const CTip = ({ active, payload, label }) => {
  if (!active||!payload?.length) return null;
  return (
    <div style={{ background:"rgba(6,9,15,.97)", border:"1px solid rgba(255,211,0,.3)", borderRadius:8, padding:"8px 12px", fontSize:12 }}>
      <div style={{ color:"#556", fontSize:10, marginBottom:2 }}>{label}</div>
      <div style={{ color:"#FFD300", fontWeight:700 }}>₩{fmt(payload[0].value)}</div>
    </div>
  );
};

/* ═══════════════════════════════════════════
   원차트 아이콘 SVG
═══════════════════════════════════════════ */
const PieIcon = ({ active }) => (
  <svg width="20" height="20" viewBox="0 0 20 20">
    <circle cx="10" cy="10" r="8" fill="none" stroke={active?"#FFD300":"#4A5568"} strokeWidth="2.5"/>
    <path d="M10 10 L10 2 A8 8 0 0 1 17.66 14 Z" fill={active?"#FFD300":"#4A5568"} opacity="0.85"/>
    <path d="M10 10 L17.66 14 A8 8 0 0 1 2 14 Z" fill={active?"rgba(255,211,0,0.5)":"rgba(74,85,104,0.5)"}/>
  </svg>
);

/* ═══════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════ */
export default function App() {
  const [stocks,    setStocks]    = useState(() => lsLoad() || SAMPLE);
  const [usdKrw,   setUsdKrw]    = useState(DEFAULT_USD_KRW);
  const [tab,       setTab]       = useState(0);
  const [sortKey,   setSortKey]   = useState("value");
  const [range,     setRange]     = useState(2);
  const [openId,    setOpenId]    = useState(null);
  const [stockRng,  setStockRng]  = useState(2);
  const [activeIdx, setActiveIdx] = useState(0);
  const [mktFilter, setMktFilter] = useState("ALL"); // ALL | KR | US

  // AI
  const [aiPrompt,  setAiPrompt]  = useState("");
  const [aiMsgs,    setAiMsgs]    = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const chatEndRef = useRef(null);

  // 모달
  const [stockModal, setStockModal] = useState(null); // null|"add"|{stock}
  const [tradeModal, setTradeModal] = useState(null); // null|stockId
  const [form,  setForm]  = useState({ name:"", ticker:"", market:"KR", currentPrice:"", avgPrice:"", qty:"" });
  const [tForm, setTForm] = useState({ date:"", type:"buy", qty:"", price:"" });
  const [showFx, setShowFx] = useState(false);

  // ── 지수 티커 ──
  const [tickers, setTickers] = useState([
    { label:"S&P 500",  val:"5,667.20", chg:"+0.24%", up:true  },
    { label:"나스닥",    val:"17,754.82",chg:"-0.11%", up:false },
    { label:"코스피",    val:"2,531.45", chg:"+0.87%", up:true  },
    { label:"코스닥",    val:"730.21",   chg:"+1.12%", up:true  },
    { label:"다우존스",  val:"41,488.19",chg:"+0.04%", up:true  },
    { label:"니케이",    val:"38,026.35",chg:"-0.45%", up:false },
    { label:"USD/KRW",  val:"1,370.50", chg:"-0.18%", up:false },
    { label:"USD/JPY",  val:"149.82",   chg:"+0.22%", up:true  },
    { label:"BTC",      val:"$67,240",  chg:"+2.14%", up:true  },
    { label:"WTI유가",   val:"$78.32",   chg:"-0.63%", up:false },
  ]);
  const [tickerLoading, setTickerLoading] = useState(false);
  const [lastUpdated,   setLastUpdated]   = useState("");

  // Claude API로 실시간 지수 조회
  const fetchTickers = useCallback(async () => {
    setTickerLoading(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514",
          max_tokens:600,
          tools:[{ type:"web_search_20250305", name:"web_search" }],
          messages:[{ role:"user", content:`지금 이 시각 실시간 시장 데이터를 검색해서 아래 항목의 현재값과 전일대비 등락률을 JSON 배열로만 반환하세요. 다른 텍스트 없이 JSON만:
[
  {"label":"S&P 500","val":"숫자","chg":"+0.00%","up":true},
  {"label":"나스닥","val":"숫자","chg":"+0.00%","up":true},
  {"label":"코스피","val":"숫자","chg":"+0.00%","up":true},
  {"label":"코스닥","val":"숫자","chg":"+0.00%","up":true},
  {"label":"다우존스","val":"숫자","chg":"+0.00%","up":true},
  {"label":"니케이","val":"숫자","chg":"+0.00%","up":true},
  {"label":"USD/KRW","val":"숫자","chg":"+0.00%","up":true},
  {"label":"USD/JPY","val":"숫자","chg":"+0.00%","up":true},
  {"label":"BTC","val":"$숫자","chg":"+0.00%","up":true},
  {"label":"WTI유가","val":"$숫자","chg":"+0.00%","up":true}
]
up은 상승이면 true, 하락이면 false. JSON 배열만 출력.` }]
        }),
      });
      const data = await res.json();
      const text = data.content?.map(b=>b.text||"").join("") || "";
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setTickers(parsed);
          const now = new Date();
          setLastUpdated(`${now.getHours().toString().padStart(2,"0")}:${now.getMinutes().toString().padStart(2,"0")} 업데이트`);
          // 환율도 자동 반영
          const fxItem = parsed.find(t=>t.label==="USD/KRW");
          if (fxItem) {
            const fxNum = parseFloat(fxItem.val.replace(/,/g,""));
            if (fxNum > 900 && fxNum < 2000) setUsdKrw(Math.round(fxNum));
          }
        }
      }
    } catch(e) { console.warn("ticker fetch failed", e); }
    setTickerLoading(false);
  }, []);

  useEffect(() => { fetchTickers(); }, []);

  const persist = useCallback((next) => { setStocks(next); lsSave(next); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [aiMsgs]);

  /* ── 포트폴리오 계산 ── */
  const pfData = useMemo(() => {
    const items = stocks.map(s => ({ ...s, _c: calcKRW(s, usdKrw) }));
    let v=0, c=0;
    for (const s of items) { v += s._c.valueKRW; c += s._c.costKRW; }
    return { items, totalValue:v, totalCost:c, profit:v-c, ret:c>0?(v-c)/c*100:0 };
  }, [stocks, usdKrw]);

  const filtered = useMemo(() => {
    let arr = [...pfData.items];
    if (mktFilter !== "ALL") arr = arr.filter(s => s.market === mktFilter);
    if (sortKey==="name")   arr.sort((a,b)=>a.name.localeCompare(b.name));
    if (sortKey==="value")  arr.sort((a,b)=>b._c.valueKRW-a._c.valueKRW);
    if (sortKey==="return") arr.sort((a,b)=>b._c.ret-a._c.ret);
    if (sortKey==="profit") arr.sort((a,b)=>b._c.profitKRW-a._c.profitKRW);
    return arr;
  }, [pfData, sortKey, mktFilter]);

  const history = useMemo(()=>buildHistory(stocks,range,usdKrw),[stocks,range,usdKrw]);
  const pieData  = useMemo(()=>pfData.items.filter(s=>s._c.valueKRW>0).map(s=>({ name:s.name, value:s._c.valueKRW })),[pfData]);

  /* ── AI 컨텍스트 ── */
  const pfContext = useMemo(()=>{
    const lines = pfData.items.map(s=>{
      const c=s._c;
      const px = s.market==="US" ? `$${fmtUS(s.currentPrice)} (₩${fmt(c.currentPriceKRW)})` : `₩${fmt(s.currentPrice)}`;
      const avg = s.market==="US" ? `$${fmtUS(c.avgPrice)} (₩${fmt(c.avgPriceKRW)})` : `₩${fmt(c.avgPrice)}`;
      return `• ${s.name}(${s.ticker||"-"}, ${s.market==="US"?"미국":"한국"}): 현재가 ${px}, 보유 ${c.qty}주, 평균단가 ${avg}, 평가액 ₩${fmt(c.valueKRW)}, 수익률 ${c.ret.toFixed(2)}%`;
    });
    return lines.join("\n")+`\n총 평가액: ₩${fmt(pfData.totalValue)}, 총 수익률: ${pfData.ret.toFixed(2)}%, USD/KRW: ${usdKrw}`;
  },[pfData,usdKrw]);

  const aiSystem = `당신은 한국·미국 주식 전문 투자 분석가입니다. 사용자의 포트폴리오를 바탕으로 실용적인 투자 판단을 제공합니다.

현재 포트폴리오:
${pfContext}

답변 형식:
- 이모지 섹션 구분 활용 (📊 📈 🎯 💎 🚀 ⚡ 등)
- 구체적인 가격/수치 포함
- 한국어, 모바일 최적화 (짧고 명확한 문장)
- 마지막에 "⚠️ 참고용 분석이며 투자 결정은 본인 책임입니다" 한 줄 추가
- 마크다운 # ** 등 사용 금지`;

  const sendAI = async (promptText) => {
    const q = (promptText||aiPrompt).trim();
    if (!q||aiLoading) return;
    setAiPrompt("");
    setAiMsgs(prev=>[...prev,{role:"user",text:q}]);
    setAiLoading(true);
    try {
      const ans = await callAI(q, aiSystem);
      setAiMsgs(prev=>[...prev,{role:"ai",text:ans}]);
    } catch(e) {
      setAiMsgs(prev=>[...prev,{role:"ai",text:`⚠️ 오류: ${e.message}\n잠시 후 다시 시도해주세요.`}]);
    }
    setAiLoading(false);
  };

  /* ── 종목 CRUD ── */
  const openAdd = () => {
    setForm({ name:"", ticker:"", market:"KR", currentPrice:"", avgPrice:"", qty:"" });
    setStockModal("add");
  };
  const openEdit = (s) => {
    const c = calcRaw(s);
    setForm({ name:s.name, ticker:s.ticker, market:s.market||"KR", currentPrice:s.currentPrice, avgPrice: c.avgPrice>0?c.avgPrice.toFixed(s.market==="US"?2:0):"", qty:"" });
    setStockModal(s);
  };
  const saveStock = () => {
    if (!form.name||!form.currentPrice) return;
    if (stockModal==="add") {
      // 평단가+수량으로 trade 생성
      const trades = (form.avgPrice && form.qty)
        ? [{ date: new Date().toISOString().slice(0,10), type:"buy", qty:+form.qty, price:+form.avgPrice }]
        : [];
      persist([...stocks, {
        id: Date.now(), name:form.name, ticker:form.ticker,
        market: form.market, currentPrice:+form.currentPrice,
        trades, priceHistory:[],
      }]);
    } else {
      persist(stocks.map(s => s.id===stockModal.id
        ? { ...s, name:form.name, ticker:form.ticker, market:form.market, currentPrice:+form.currentPrice }
        : s));
    }
    setStockModal(null);
  };
  const delStock = (id) => { if(window.confirm("이 종목을 삭제할까요?")) persist(stocks.filter(s=>s.id!==id)); };

  const saveTrade = () => {
    if (!tForm.date||!tForm.qty||!tForm.price) return;
    persist(stocks.map(s => s.id===tradeModal
      ? {...s, trades:[...s.trades,{date:tForm.date,type:tForm.type,qty:+tForm.qty,price:+tForm.price}]}
      : s));
    setTradeModal(null);
  };
  const delTrade = (sid,idx) => persist(stocks.map(s => s.id===sid ? {...s,trades:s.trades.filter((_,i)=>i!==idx)} : s));

  /* ── 스타일 ── */
  const C = { bg:"#06090F", card:"#0C1018", border:"rgba(255,211,0,.12)", accent:"#FFD300", text:"#DDE0EE", muted:"#4A5568", green:"#34D399", red:"#F87171" };
  const inp = { background:"#080C18", border:"1px solid rgba(255,211,0,.2)", borderRadius:10, color:C.text, padding:"11px 13px", fontSize:14, outline:"none", width:"100%", fontFamily:"inherit", WebkitAppearance:"none", boxSizing:"border-box" };
  const sel = { ...inp, cursor:"pointer" };
  const btnY = { background:C.accent, color:"#06090F", border:"none", borderRadius:10, padding:"12px 20px", fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"inherit" };
  const btnG = { background:"rgba(255,211,0,.08)", color:C.accent, border:"1px solid rgba(255,211,0,.2)", borderRadius:8, padding:"7px 14px", fontSize:12, cursor:"pointer", fontFamily:"inherit" };
  const btnR = { background:"rgba(248,113,113,.08)", color:C.red, border:"1px solid rgba(248,113,113,.2)", borderRadius:8, padding:"5px 10px", fontSize:11, cursor:"pointer" };

  /* ── 탭 아이콘 ── */
  const TabIcon = ({ i }) => {
    const active = tab===i;
    const color = active ? C.accent : C.muted;
    if (i===1) return <PieIcon active={active}/>;
    const icons = ["📊","","🤖","✏️","🔌"];
    return <span style={{ fontSize:18 }}>{icons[i]}</span>;
  };

  return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text, fontFamily:"'Noto Sans KR','Apple SD Gothic Neo',sans-serif", paddingBottom:"calc(72px + env(safe-area-inset-bottom))" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&family=Bebas+Neue&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
        ::-webkit-scrollbar{display:none;}
        input:focus,select:focus,textarea:focus{border-color:rgba(255,211,0,.5)!important;outline:none;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes marquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
        .fade{animation:fadeUp .2s ease}
        .slide{animation:slideIn .15s ease}
        .press:active{opacity:.7;transform:scale(.98);transition:all .1s}
        input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none}
      `}</style>

      {/* ════ TICKER MARQUEE BAR ════ */}
      <div style={{ background:"#06090F", borderBottom:"1px solid rgba(255,211,0,.08)", overflow:"hidden", height:32, display:"flex", alignItems:"center", position:"relative" }}>
        {/* 좌우 페이드 마스크 */}
        <div style={{ position:"absolute", left:0, top:0, bottom:0, width:32, background:"linear-gradient(to right,#06090F,transparent)", zIndex:2, pointerEvents:"none" }}/>
        <div style={{ position:"absolute", right:0, top:0, bottom:0, width:32, background:"linear-gradient(to left,#06090F,transparent)", zIndex:2, pointerEvents:"none" }}/>
        {/* 업데이트 버튼 */}
        <button onClick={fetchTickers} disabled={tickerLoading}
          style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", zIndex:3, background:"rgba(255,211,0,.1)", border:"1px solid rgba(255,211,0,.2)", borderRadius:5, padding:"2px 7px", fontSize:9, color:tickerLoading?"#556":C.accent, cursor:"pointer", flexShrink:0, fontFamily:"inherit" }}>
          {tickerLoading ? "⟳" : "↻"}
        </button>
        {/* 스크롤 트랙 */}
        <div style={{ display:"flex", animation:"marquee 38s linear infinite", whiteSpace:"nowrap", alignItems:"center" }}>
          {[...tickers, ...tickers].map((t, i) => (
            <div key={i} style={{ display:"inline-flex", alignItems:"center", gap:5, paddingRight:28, flexShrink:0 }}>
              <span style={{ fontSize:10, color:"#667", letterSpacing:.3 }}>{t.label}</span>
              <span style={{ fontSize:11, fontWeight:600, color:"#CCD", letterSpacing:.3 }}>{t.val}</span>
              <span style={{ fontSize:10, fontWeight:700, color: t.up ? "#34D399" : "#F87171" }}>{t.chg}</span>
              <span style={{ fontSize:9, color:"#2a3040", marginLeft:4 }}>|</span>
            </div>
          ))}
        </div>
      </div>

      {/* ════ HEADER ════ */}
      <div style={{ background:"rgba(6,9,15,.96)", backdropFilter:"blur(16px)", WebkitBackdropFilter:"blur(16px)", borderBottom:`1px solid ${C.border}`, padding:"env(safe-area-inset-top) 16px 0", position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, paddingTop:14, marginBottom:10 }}>
          <svg width="30" height="30" viewBox="0 0 30 30" fill="none" style={{ flexShrink:0 }}>
            <rect width="30" height="30" rx="8" fill="#FFD300"/>
            {/* cloud shape */}
            <path d="M22 18.5C23.38 18.5 24.5 17.38 24.5 16C24.5 14.74 23.56 13.71 22.33 13.53C22.44 13.2 22.5 12.85 22.5 12.5C22.5 10.57 20.93 9 19 9C17.96 9 17.03 9.47 16.41 10.21C15.88 9.46 15.01 9 14 9C12.34 9 11 10.34 11 12C11 12.14 11.01 12.28 11.03 12.41C9.87 12.74 9 13.8 9 15C9 16.38 10.12 17.5 11.5 17.5L22 18.5Z" fill="none" stroke="#06090F" strokeWidth="1.3" strokeLinejoin="round"/>
            <path d="M22.5 18.5C23.88 18.5 25 17.38 25 16C25 14.7 24.01 13.63 22.74 13.52C22.91 13.05 23 12.54 23 12C23 9.79 21.21 8 19 8C17.8 8 16.72 8.54 16 9.4C15.33 8.54 14.24 8 13 8C10.79 8 9 9.79 9 12C9 12.07 9 12.14 9.01 12.21C7.29 12.65 6 14.18 6 16C6 18.21 7.79 20 10 20H22C22.17 20 22.34 19.99 22.5 19.97" stroke="#06090F" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <span style={{ fontSize:15, fontWeight:700, letterSpacing:-.5 }}>포트폴리오 트래커</span>
          {lastUpdated && <span style={{ fontSize:9, color:"#445", marginLeft:2 }}>{lastUpdated}</span>}
          {/* 환율 표시 */}
          <button onClick={()=>setShowFx(v=>!v)} style={{ marginLeft:"auto", background:"rgba(255,211,0,.08)", border:"1px solid rgba(255,211,0,.2)", borderRadius:8, padding:"4px 10px", fontSize:11, color:C.accent, cursor:"pointer", fontFamily:"inherit" }}>
            💱 {usdKrw.toLocaleString()}
          </button>
        </div>
        {/* 환율 입력 (토글) */}
        {showFx && (
          <div className="slide" style={{ paddingBottom:10, display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:12, color:C.muted, flexShrink:0 }}>USD/KRW</span>
            <input type="number" inputMode="numeric" value={usdKrw} onChange={e=>setUsdKrw(+e.target.value||1370)}
              style={{ ...inp, padding:"7px 10px", fontSize:13 }}/>
            <button onClick={()=>setShowFx(false)} style={{ ...btnY, padding:"7px 12px", fontSize:12, flexShrink:0 }}>적용</button>
          </div>
        )}
        {/* AI 프롬프트 바 */}
        <div style={{ display:"flex", gap:8, alignItems:"center", paddingBottom:12 }}>
          <div style={{ flex:1, background:"rgba(255,255,255,.04)", border:`1px solid rgba(255,211,0,.18)`, borderRadius:12, padding:"9px 13px", display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:13 }}>🤖</span>
            <input
              value={aiPrompt}
              onChange={e=>setAiPrompt(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter"&&aiPrompt.trim()){ sendAI(); setTab(2); }}}
              placeholder="종목 분석, 매수·매도 타이밍 물어보기..."
              style={{ background:"none", border:"none", color:C.text, fontSize:13, outline:"none", flex:1, fontFamily:"inherit" }}
            />
          </div>
          <button onClick={()=>{ if(aiPrompt.trim()){ sendAI(); setTab(2); }}}
            disabled={aiLoading||!aiPrompt.trim()}
            style={{ ...btnY, padding:"9px 14px", borderRadius:12, opacity:(!aiPrompt.trim()||aiLoading)?.5:1, flexShrink:0, fontSize:16 }}>
            {aiLoading?"⏳":"↑"}
          </button>
        </div>
      </div>

      {/* ════ CONTENT ════ */}
      <div style={{ padding:"0 16px" }}>

        {/* ──────── TAB 0: 홈 ──────── */}
        {tab===0 && (
          <div className="fade">
            {/* 총자산 카드 */}
            <div style={{ background:"linear-gradient(135deg,#0F1628,#090E1E)", border:`1px solid rgba(255,211,0,.22)`, borderRadius:20, padding:"22px 20px", marginTop:14, marginBottom:12, position:"relative", overflow:"hidden" }}>
              <div style={{ position:"absolute",top:-50,right:-50,width:160,height:160,background:"radial-gradient(circle,rgba(255,211,0,.07),transparent 70%)",borderRadius:"50%",pointerEvents:"none" }}/>
              <div style={{ fontSize:10, color:C.muted, letterSpacing:1.8, textTransform:"uppercase", marginBottom:8 }}>총 평가금액 (원화 환산)</div>
              <div style={{ fontSize:32, fontWeight:700, fontFamily:"'Bebas Neue',monospace", letterSpacing:2, color:"#F0F2FF", marginBottom:10 }}>₩{fmt(pfData.totalValue)}</div>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
                <span style={{ color:pfData.profit>=0?C.green:C.red, fontSize:14, fontWeight:600 }}>
                  {pfData.profit>=0?"▲":"▼"} ₩{fmt(Math.abs(pfData.profit))}
                </span>
                <span style={{ fontSize:12, padding:"3px 10px", borderRadius:20, background:pfData.profit>=0?"rgba(52,211,153,.12)":"rgba(248,113,113,.12)", color:pfData.profit>=0?C.green:C.red }}>
                  {pfData.ret>=0?"+":""}{pfData.ret.toFixed(2)}%
                </span>
              </div>
              <div style={{ display:"flex", gap:20 }}>
                {[
                  ["매입금액",`₩${fmt(pfData.totalCost)}`],
                  ["국장",`${stocks.filter(s=>s.market==="KR").length}종목`],
                  ["미장",`${stocks.filter(s=>s.market==="US").length}종목`],
                ].map(([l,v])=>(
                  <div key={l}><div style={{ fontSize:10, color:"#334", marginBottom:2 }}>{l}</div><div style={{ fontSize:12, color:"#778" }}>{v}</div></div>
                ))}
              </div>
            </div>

            {/* 전체 추이 */}
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:"14px 12px 10px", marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <span style={{ fontSize:12, color:C.muted }}>전체 자산 추이 (원화)</span>
                <div style={{ display:"flex", gap:4 }}>
                  {RANGE.map(r=>(
                    <button key={r.label} onClick={()=>setRange(r.n)} style={{ padding:"3px 11px", fontSize:11, borderRadius:20, border:"none", cursor:"pointer", background:range===r.n?C.accent:"rgba(255,255,255,.06)", color:range===r.n?"#06090F":C.muted, fontWeight:range===r.n?700:400 }}>{r.label}</button>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={120}>
                <AreaChart data={history} margin={{ top:4, right:4, left:-24, bottom:0 }}>
                  <defs>
                    <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#FFD300" stopOpacity={0.25}/>
                      <stop offset="95%" stopColor="#FFD300" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,.03)"/>
                  <XAxis dataKey="date" tick={{ fill:"#445", fontSize:9 }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fill:"#445", fontSize:9 }} axisLine={false} tickLine={false} tickFormatter={v=>fmtW(v)}/>
                  <Tooltip content={<CTip/>}/>
                  <Area type="monotone" dataKey="value" stroke="#FFD300" strokeWidth={2} fill="url(#pg)" dot={false} activeDot={{ r:4, fill:"#FFD300", stroke:"#06090F", strokeWidth:2 }}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* 마켓 필터 + 정렬 */}
            <div style={{ display:"flex", gap:6, marginBottom:8, overflowX:"auto", paddingBottom:2 }}>
              {[{k:"ALL",l:"전체"},{k:"KR",l:"🇰🇷 국장"},{k:"US",l:"🇺🇸 미장"}].map(o=>(
                <button key={o.k} onClick={()=>setMktFilter(o.k)} style={{ padding:"5px 13px", fontSize:11, borderRadius:20, border:`1px solid ${mktFilter===o.k?"rgba(255,211,0,.4)":C.border}`, cursor:"pointer", flexShrink:0, background:mktFilter===o.k?"rgba(255,211,0,.12)":"rgba(255,255,255,.03)", color:mktFilter===o.k?C.accent:C.muted, fontWeight:mktFilter===o.k?700:400 }}>{o.l}</button>
              ))}
              <div style={{ width:1, background:C.border, flexShrink:0 }}/>
              {SORT.map(o=>(
                <button key={o.key} onClick={()=>setSortKey(o.key)} style={{ padding:"5px 13px", fontSize:11, borderRadius:20, border:"none", cursor:"pointer", flexShrink:0, background:sortKey===o.key?C.accent:"rgba(255,255,255,.06)", color:sortKey===o.key?"#06090F":C.muted, fontWeight:sortKey===o.key?700:400 }}>{o.label}</button>
              ))}
            </div>

            {/* 종목 카드 */}
            {filtered.map(stock=>{
              const c=stock._c; const isUS=stock.market==="US";
              const pct=pfData.totalValue>0?(c.valueKRW/pfData.totalValue)*100:0;
              const isOpen=openId===stock.id;
              const h=hue(stock.id);
              const sHist=stock.priceHistory.slice(-stockRng);
              return (
                <div key={stock.id} style={{ marginBottom:8 }}>
                  <div className="press" onClick={()=>setOpenId(isOpen?null:stock.id)}
                    style={{ background:isOpen?"rgba(255,211,0,.07)":"rgba(255,255,255,.025)", border:`1px solid ${isOpen?"rgba(255,211,0,.3)":C.border}`, borderRadius:isOpen?"14px 14px 0 0":14, padding:"13px 14px", cursor:"pointer" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                      <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                        <div style={{ width:38, height:38, borderRadius:10, background:`hsl(${h},45%,14%)`, border:`1px solid hsl(${h},55%,24%)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:`hsl(${h},70%,65%)`, flexShrink:0, flexDirection:"column", gap:1 }}>
                          <span>{stock.name.slice(0,2)}</span>
                          <span style={{ fontSize:8, opacity:.7 }}>{isUS?"🇺🇸":"🇰🇷"}</span>
                        </div>
                        <div>
                          <div style={{ fontSize:15, fontWeight:600, marginBottom:2 }}>{stock.name}</div>
                          <div style={{ fontSize:10, color:C.muted }}>{c.qty}주 · 평균 {fmtPx(stock, c.avgPrice)}</div>
                        </div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:13, fontWeight:700, marginBottom:1 }}>
                          {isUS ? `$${fmtUS(c.value)}` : `₩${fmt(c.value)}`}
                        </div>
                        <div style={{ fontSize:11, color:C.muted, marginBottom:2 }}>₩{fmt(c.valueKRW)}</div>
                        <div style={{ fontSize:12, fontWeight:500, color:c.ret>=0?C.green:C.red }}>
                          {c.ret>=0?"+":""}{c.ret.toFixed(2)}%
                          <span style={{ fontSize:10, opacity:.6, marginLeft:3 }}>({c.profit>=0?"+":""}
                            {isUS?`$${fmtUS(Math.abs(c.profit)))}`:`₩${fmt(Math.abs(c.profit))}`})
                          </span>
                        </div>
                      </div>
                    </div>
                    <div style={{ marginTop:9 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                        <span style={{ fontSize:9, color:"#334" }}>비중</span>
                        <span style={{ fontSize:9, color:"#445" }}>{pct.toFixed(1)}%</span>
                      </div>
                      <div style={{ height:3, background:"rgba(255,255,255,.05)", borderRadius:3 }}>
                        <div style={{ height:"100%", width:`${pct}%`, background:`hsl(${h},70%,55%)`, borderRadius:3, transition:"width .4s" }}/>
                      </div>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="slide" style={{ background:"#080D1A", border:`1px solid rgba(255,211,0,.18)`, borderTop:"none", borderRadius:"0 0 14px 14px", padding:"14px" }}>
                      {/* 지표 6개 */}
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginBottom:12 }}>
                        {[
                          ["현재가",  fmtPx(stock,stock.currentPrice), C.text],
                          ["평가액",  isUS?`$${fmtUS(c.value)}`:`₩${fmtW(c.value)}`, C.text],
                          ["수익률",  `${c.ret>=0?"+":""}${c.ret.toFixed(2)}%`, c.ret>=0?C.green:C.red],
                          ["평균단가",fmtPx(stock,c.avgPrice),"#88a"],
                          ["보유수량",`${c.qty}주`,"#88a"],
                          ["원화환산",`₩${fmtW(c.valueKRW)}`,C.accent],
                        ].map(([l,v,col])=>(
                          <div key={l} style={{ background:"#0A0E1A", borderRadius:9, padding:"8px", textAlign:"center" }}>
                            <div style={{ fontSize:9, color:"#445", marginBottom:3 }}>{l}</div>
                            <div style={{ fontSize:11, fontWeight:600, color:col }}>{v}</div>
                          </div>
                        ))}
                      </div>

                      {/* 차트 */}
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                        <span style={{ fontSize:10, color:C.muted }}>주가 추이</span>
                        <div style={{ display:"flex", gap:3 }}>
                          {RANGE.map(r=>(
                            <button key={r.label} onClick={e=>{e.stopPropagation();setStockRng(r.n);}} style={{ padding:"2px 9px", fontSize:10, borderRadius:20, border:"none", cursor:"pointer", background:stockRng===r.n?C.accent:"rgba(255,255,255,.06)", color:stockRng===r.n?"#06090F":C.muted }}>{r.label}</button>
                          ))}
                        </div>
                      </div>
                      {sHist.length>1 ? (
                        <ResponsiveContainer width="100%" height={110}>
                          <AreaChart data={sHist} margin={{ top:2, right:4, left:-24, bottom:0 }}>
                            <defs>
                              <linearGradient id={`sg${stock.id}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor={`hsl(${h},70%,55%)`} stopOpacity={.28}/>
                                <stop offset="95%" stopColor={`hsl(${h},70%,55%)`} stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,.03)"/>
                            <XAxis dataKey="date" tick={{ fill:"#445", fontSize:9 }} axisLine={false} tickLine={false}/>
                            <YAxis tick={{ fill:"#445", fontSize:9 }} axisLine={false} tickLine={false} tickFormatter={v=>isUS?`$${v}`:`₩${fmtW(v)}`}/>
                            <Tooltip content={<CTip/>}/>
                            <ReferenceLine y={c.avgPrice} stroke="rgba(255,211,0,.4)" strokeDasharray="4 3" label={{ value:"평균", fill:"#FFD300", fontSize:9, position:"insideTopLeft" }}/>
                            <Area type="monotone" dataKey="price" stroke={`hsl(${h},70%,55%)`} strokeWidth={2} fill={`url(#sg${stock.id})`} dot={false} activeDot={{ r:3 }}/>
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <div style={{ height:60, display:"flex", alignItems:"center", justifyContent:"center", color:C.muted, fontSize:12 }}>가격 이력 없음</div>
                      )}

                      {/* AI 분석 버튼 */}
                      <button onClick={e=>{ e.stopPropagation(); const q=`${stock.name}(${stock.ticker}) ${stock.market==="US"?"미국주식":"한국주식"} 분석해줘. 현재가 ${fmtPx(stock,stock.currentPrice)}, 평균단가 ${fmtPx(stock,c.avgPrice)}, 수익률 ${c.ret.toFixed(2)}%`; setAiPrompt(q); sendAI(q); setTab(2); }}
                        style={{ ...btnG, width:"100%", textAlign:"center", marginTop:10, padding:"10px" }}>
                        🤖 이 종목 AI 분석 →
                      </button>

                      {/* 매매내역 */}
                      <div style={{ marginTop:12 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                          <span style={{ fontSize:11, color:C.muted }}>매매내역</span>
                          <button style={btnG} onClick={e=>{ e.stopPropagation(); setTForm({date:"",type:"buy",qty:"",price:""}); setTradeModal(stock.id); }}>+ 추가</button>
                        </div>
                        {stock.trades.length===0
                          ? <div style={{ color:C.muted, fontSize:12, textAlign:"center", padding:"10px 0" }}>매매내역 없음</div>
                          : [...stock.trades].reverse().map((t,i)=>(
                              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 10px", background:"rgba(255,255,255,.03)", borderRadius:8, marginBottom:5 }}>
                                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                                  <span style={{ fontSize:10, padding:"2px 8px", borderRadius:10, background:t.type==="buy"?"rgba(52,211,153,.12)":"rgba(248,113,113,.12)", color:t.type==="buy"?C.green:C.red, fontWeight:700 }}>{t.type==="buy"?"매수":"매도"}</span>
                                  <div>
                                    <div style={{ fontSize:11, color:C.muted }}>{t.date}</div>
                                    <div style={{ fontSize:12 }}>{t.qty}주 · {fmtPx(stock,t.price)}</div>
                                  </div>
                                </div>
                                <button style={btnR} onClick={e=>{ e.stopPropagation(); delTrade(stock.id, stock.trades.length-1-i); }}>삭제</button>
                              </div>
                            ))
                        }
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ──────── TAB 1: 비중 ──────── */}
        {tab===1 && (
          <div className="fade" style={{ marginTop:16 }}>
            <div style={{ fontSize:16, fontWeight:700, marginBottom:2 }}>종목별 비중</div>
            <div style={{ fontSize:12, color:C.muted, marginBottom:14 }}>총 ₩{fmt(pfData.totalValue)} (원화 환산)</div>

            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:18, padding:"16px 8px 12px", marginBottom:12 }}>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie activeIndex={activeIdx} activeShape={renderActiveShape}
                    data={pieData} cx="50%" cy="50%"
                    innerRadius={68} outerRadius={105}
                    dataKey="value"
                    onMouseEnter={(_,i)=>setActiveIdx(i)}
                    onClick={(_,i)=>setActiveIdx(i)}
                    strokeWidth={0} paddingAngle={2}>
                    {pieData.map((_,i)=>(
                      <Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}/>
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* 범례 리스트 */}
            {pfData.items.filter(s=>s._c.valueKRW>0).sort((a,b)=>b._c.valueKRW-a._c.valueKRW).map((s,i)=>{
              const pct=pfData.totalValue>0?(s._c.valueKRW/pfData.totalValue)*100:0;
              const color=PIE_COLORS[i%PIE_COLORS.length];
              const isActive=pieData.findIndex(p=>p.name===s.name)===activeIdx;
              return (
                <div key={s.id} onClick={()=>setActiveIdx(pieData.findIndex(p=>p.name===s.name))}
                  style={{ background:isActive?"rgba(255,211,0,.07)":"rgba(255,255,255,.025)", border:`1px solid ${isActive?color+"55":C.border}`, borderRadius:12, padding:"12px 14px", marginBottom:7, cursor:"pointer", transition:"all .15s" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ width:10, height:10, borderRadius:3, background:color, flexShrink:0 }}/>
                      <div>
                        <div style={{ fontSize:14, fontWeight:600 }}>{s.name} <span style={{ fontSize:10, color:C.muted }}>{s.market==="US"?"🇺🇸":"🇰🇷"}</span></div>
                        <div style={{ fontSize:10, color:C.muted, marginTop:1 }}>{s._c.qty}주 · {fmtPx(s,s.currentPrice)}</div>
                      </div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:16, fontWeight:700, color }}>{pct.toFixed(1)}%</div>
                      <div style={{ fontSize:11, color:C.muted }}>₩{fmt(s._c.valueKRW)}</div>
                    </div>
                  </div>
                  <div style={{ marginTop:8, height:3, background:"rgba(255,255,255,.05)", borderRadius:3 }}>
                    <div style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:3, transition:"width .5s" }}/>
                  </div>
                  <div style={{ display:"flex", gap:14, marginTop:7 }}>
                    <span style={{ fontSize:11, color:s._c.ret>=0?C.green:C.red, fontWeight:600 }}>{s._c.ret>=0?"+":""}{s._c.ret.toFixed(2)}%</span>
                    <span style={{ fontSize:11, color:C.muted }}>{s._c.profit>=0?"+":""}{fmtPx(s,s._c.profit)}</span>
                    <span style={{ fontSize:11, color:"#445" }}>원화 {s._c.profitKRW>=0?"+":""}₩{fmt(s._c.profitKRW)}</span>
                  </div>
                </div>
              );
            })}

            {pfData.items.some(s=>pfData.totalValue>0&&(s._c.valueKRW/pfData.totalValue)>0.4) && (
              <div style={{ background:"rgba(248,113,113,.07)", border:"1px solid rgba(248,113,113,.2)", borderRadius:12, padding:"12px 14px", marginTop:4 }}>
                <div style={{ fontSize:12, color:C.red, fontWeight:600, marginBottom:3 }}>⚠️ 집중도 경고</div>
                <div style={{ fontSize:12, color:"#778", lineHeight:1.6 }}>특정 종목 비중 40% 초과. 분산 투자를 고려하세요.</div>
              </div>
            )}
          </div>
        )}

        {/* ──────── TAB 2: AI 분석 ──────── */}
        {tab===2 && (
          <div className="fade" style={{ marginTop:16 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
              <div style={{ width:36, height:36, borderRadius:10, background:"rgba(255,211,0,.12)", border:"1px solid rgba(255,211,0,.3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🤖</div>
              <div>
                <div style={{ fontSize:15, fontWeight:700 }}>AI 투자 분석</div>
                <div style={{ fontSize:11, color:C.muted }}>국장·미장 포트폴리오 기반 실시간 분석</div>
              </div>
            </div>

            {/* 빠른 질문 */}
            <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:8, marginBottom:14 }}>
              {QUICK_Q.map(q=>(
                <button key={q} onClick={()=>sendAI(q)}
                  style={{ flexShrink:0, background:"rgba(255,211,0,.07)", border:"1px solid rgba(255,211,0,.18)", borderRadius:20, padding:"7px 13px", fontSize:11, color:C.accent, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" }}>
                  {q}
                </button>
              ))}
            </div>

            {/* 채팅 */}
            <div style={{ minHeight:200 }}>
              {aiMsgs.length===0 && (
                <div style={{ background:"rgba(255,255,255,.03)", border:`1px solid ${C.border}`, borderRadius:16, padding:"22px 16px", textAlign:"center" }}>
                  <div style={{ fontSize:30, marginBottom:10 }}>📈</div>
                  <div style={{ fontSize:14, fontWeight:600, marginBottom:8 }}>AI 투자 어시스턴트</div>
                  <div style={{ fontSize:12, color:C.muted, lineHeight:1.7, marginBottom:16 }}>
                    위 입력창 또는 빠른 질문으로<br/>종목 분석을 시작하세요
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                    {[["🎯","지지선·저항선","추천 매수·매도가"],["💎","텐배거","10배 상승 가능성"],["🚀","룰브레이커","업계 판도변화 종목"],["⚡","리스크","포트폴리오 위험도"]].map(([ic,t,d])=>(
                      <button key={t} onClick={()=>sendAI(t+" 분석해줘")}
                        style={{ background:"rgba(255,255,255,.025)", border:`1px solid ${C.border}`, borderRadius:10, padding:"12px 10px", textAlign:"left", cursor:"pointer", fontFamily:"inherit" }}>
                        <div style={{ fontSize:20, marginBottom:4 }}>{ic}</div>
                        <div style={{ fontSize:12, fontWeight:600, color:C.text }}>{t}</div>
                        <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>{d}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {aiMsgs.map((msg,i)=>(
                <div key={i} style={{ marginBottom:14, display:"flex", flexDirection:"column", alignItems:msg.role==="user"?"flex-end":"flex-start" }}>
                  {msg.role==="user" ? (
                    <div style={{ background:"rgba(255,211,0,.12)", border:"1px solid rgba(255,211,0,.25)", borderRadius:"14px 14px 2px 14px", padding:"10px 14px", maxWidth:"82%", fontSize:13, lineHeight:1.6 }}>
                      {msg.text}
                    </div>
                  ) : (
                    <div style={{ maxWidth:"97%" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:5 }}>
                        <span style={{ fontSize:14 }}>🤖</span>
                        <span style={{ fontSize:10, color:C.muted }}>AI 분석</span>
                      </div>
                      <div style={{ background:"rgba(255,255,255,.04)", border:`1px solid ${C.border}`, borderRadius:"2px 14px 14px 14px", padding:"13px 14px", fontSize:13, lineHeight:1.85, whiteSpace:"pre-wrap", color:C.text }}>
                        {msg.text}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {aiLoading && (
                <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 4px" }}>
                  <span style={{ fontSize:14 }}>🤖</span>
                  {[0,1,2].map(i=>(
                    <div key={i} style={{ width:7, height:7, borderRadius:"50%", background:C.accent, animation:"blink 1.2s ease infinite", animationDelay:`${i*.2}s` }}/>
                  ))}
                  <span style={{ fontSize:11, color:C.muted }}>분석 중...</span>
                </div>
              )}
              <div ref={chatEndRef}/>
            </div>

            {aiMsgs.length>0 && (
              <button onClick={()=>setAiMsgs([])} style={{ ...btnR, width:"100%", textAlign:"center", padding:"10px", marginTop:10 }}>대화 초기화</button>
            )}
          </div>
        )}

        {/* ──────── TAB 3: 종목관리 ──────── */}
        {tab===3 && (
          <div className="fade" style={{ marginTop:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <span style={{ fontSize:16, fontWeight:700 }}>종목 관리</span>
              <button style={btnY} onClick={openAdd}>+ 종목 추가</button>
            </div>

            {/* 안내 박스 */}
            <div style={{ background:"rgba(96,165,250,.07)", border:"1px solid rgba(96,165,250,.2)", borderRadius:12, padding:"11px 14px", marginBottom:14 }}>
              <div style={{ fontSize:12, color:"#60A5FA", fontWeight:600, marginBottom:3 }}>💡 종목 추가 방법</div>
              <div style={{ fontSize:12, color:"#556", lineHeight:1.7 }}>
                종목명·코드·시장을 선택하고, <strong style={{ color:"#99a" }}>평균 매수가</strong>와 <strong style={{ color:"#99a" }}>보유 수량</strong>을 입력하세요.<br/>
                현재가는 최근 체결가격을 입력해 수익률을 계산합니다.
              </div>
            </div>

            {stocks.map(s=>{
              const c=calcKRW(s,usdKrw);
              const isUS=s.market==="US";
              return (
                <div key={s.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px", marginBottom:10 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                    <div>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ fontSize:15, fontWeight:600 }}>{s.name}</span>
                        <span style={{ fontSize:10, background: isUS?"rgba(96,165,250,.15)":"rgba(52,211,153,.12)", color: isUS?"#60A5FA":"#34D399", padding:"1px 6px", borderRadius:6, fontWeight:600 }}>{isUS?"미장":"국장"}</span>
                      </div>
                      <div style={{ fontSize:11, color:C.muted, marginTop:3 }}>
                        {s.ticker||"코드없음"} · {c.qty}주
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:6 }}>
                      <button style={btnG} onClick={()=>openEdit(s)}>편집</button>
                      <button style={btnR} onClick={()=>delStock(s.id)}>삭제</button>
                    </div>
                  </div>
                  {/* 핵심 지표 3개 */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
                    {[
                      ["현재가",    fmtPx(s, s.currentPrice),       C.text],
                      ["평균매수가", fmtPx(s, c.avgPrice),           "#99a"],
                      ["수익률",    `${c.ret>=0?"+":""}${c.ret.toFixed(2)}%`, c.ret>=0?C.green:C.red],
                    ].map(([l,v,col])=>(
                      <div key={l} style={{ background:"rgba(255,255,255,.03)", borderRadius:8, padding:"8px", textAlign:"center" }}>
                        <div style={{ fontSize:9, color:C.muted, marginBottom:3 }}>{l}</div>
                        <div style={{ fontSize:12, fontWeight:600, color:col }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop:8, fontSize:12, color:C.muted, display:"flex", gap:16 }}>
                    <span>평가액 <span style={{ color:C.accent, fontWeight:600 }}>₩{fmt(c.valueKRW)}</span></span>
                    <span>손익 <span style={{ color:c.profitKRW>=0?C.green:C.red, fontWeight:600 }}>{c.profitKRW>=0?"+":""}₩{fmt(c.profitKRW)}</span></span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ──────── TAB 4: API ──────── */}
        {tab===4 && (
          <div className="fade" style={{ marginTop:16 }}>
            <div style={{ fontSize:16, fontWeight:700, marginBottom:4 }}>NH투자증권 API 연동</div>
            <div style={{ fontSize:12, color:C.muted, marginBottom:16 }}>실제 잔고 자동 연동을 위한 설정 안내</div>
            {[
              { step:"01", title:"QV Open API 신청", desc:"nhqv.com → 고객지원 → Open API 신청\nHTS 계좌 필요 (영업일 1~2일 소요)", warn:false },
              { step:"02", title:"App Key / Secret 발급", desc:"승인 후 개발자 센터에서 발급", warn:false },
              { step:"03", title:"⚠️ CORS 제한 (중요)", desc:"브라우저에서 NH API 직접 호출 불가.\nNode.js 또는 Python 백엔드 프록시 필요", warn:true },
              { step:"04", title:"토큰 발급", code:`POST https://openapi.nhqv.com/oauth2/token\n{\n  grant_type: "client_credentials",\n  appkey: "YOUR_KEY",\n  secretkey: "YOUR_SECRET"\n}`, warn:false },
              { step:"05", title:"잔고 조회", code:`GET /stock/accountBalance\nHeaders:\n  Authorization: Bearer {token}\n  appkey: YOUR_KEY`, warn:false },
            ].map(item=>(
              <div key={item.step} style={{ background:item.warn?"rgba(248,113,113,.06)":C.card, border:`1px solid ${item.warn?"rgba(248,113,113,.2)":C.border}`, borderRadius:12, padding:"13px 14px", marginBottom:8 }}>
                <div style={{ display:"flex", gap:10 }}>
                  <span style={{ fontSize:9, fontWeight:800, padding:"2px 7px", borderRadius:6, background:item.warn?"rgba(248,113,113,.2)":"rgba(255,211,0,.15)", color:item.warn?C.red:C.accent, flexShrink:0, marginTop:2 }}>{item.step}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:600, marginBottom:5, color:item.warn?C.red:C.text }}>{item.title}</div>
                    {item.desc&&<div style={{ fontSize:12, color:"#667", lineHeight:1.7, whiteSpace:"pre-line" }}>{item.desc}</div>}
                    {item.code&&<pre style={{ fontSize:11, color:"#99b", background:"#050810", borderRadius:8, padding:"10px 12px", marginTop:6, overflowX:"auto", lineHeight:1.7, border:"1px solid rgba(255,255,255,.05)" }}>{item.code}</pre>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ════ 하단 탭바 ════ */}
      <div style={{ position:"fixed", bottom:0, left:0, right:0, background:"rgba(6,9,15,.97)", backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)", borderTop:`1px solid ${C.border}`, display:"flex", paddingBottom:"env(safe-area-inset-bottom)", zIndex:100 }}>
        {TABS.map((t,i)=>(
          <button key={t} onClick={()=>setTab(i)} style={{ flex:1, background:"none", border:"none", cursor:"pointer", padding:"10px 0", display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
            {i===1
              ? <PieIcon active={tab===1}/>
              : <span style={{ fontSize:18 }}>{["📊","","🤖","✏️","🔌"][i]}</span>
            }
            <span style={{ fontSize:10, fontWeight:tab===i?700:400, color:tab===i?C.accent:C.muted }}>{t}</span>
          </button>
        ))}
      </div>

      {/* ════ 종목 추가/편집 모달 ════ */}
      {stockModal && (
        <div onClick={()=>setStockModal(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.78)", zIndex:200, display:"flex", alignItems:"flex-end", backdropFilter:"blur(4px)", WebkitBackdropFilter:"blur(4px)" }}>
          <div className="slide" onClick={e=>e.stopPropagation()} style={{ background:"#0D1220", borderRadius:"20px 20px 0 0", border:`1px solid rgba(255,211,0,.22)`, padding:"22px 20px calc(20px + env(safe-area-inset-bottom))", width:"100%" }}>
            <div style={{ width:36, height:4, background:"#2a3040", borderRadius:2, margin:"0 auto 18px" }}/>
            <div style={{ fontSize:17, fontWeight:700, marginBottom:16 }}>{stockModal==="add"?"종목 추가":"종목 편집"}</div>
            <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
              {/* 시장 선택 */}
              <div>
                <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>시장 *</div>
                <div style={{ display:"flex", gap:8 }}>
                  {[{v:"KR",l:"🇰🇷 한국(국장)"},{v:"US",l:"🇺🇸 미국(미장)"}].map(o=>(
                    <button key={o.v} onClick={()=>setForm(f=>({...f,market:o.v}))}
                      style={{ flex:1, padding:"10px", borderRadius:10, border:`1px solid ${form.market===o.v?"rgba(255,211,0,.5)":C.border}`, background:form.market===o.v?"rgba(255,211,0,.1)":"rgba(255,255,255,.03)", color:form.market===o.v?C.accent:C.muted, fontSize:13, cursor:"pointer", fontFamily:"inherit", fontWeight:form.market===o.v?700:400 }}>
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>종목명 *</div>
                <input style={inp} placeholder={form.market==="US"?"예: Apple":"예: 삼성전자"} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/>
              </div>
              <div>
                <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>종목코드</div>
                <input style={inp} placeholder={form.market==="US"?"예: AAPL":"예: 005930"} value={form.ticker} onChange={e=>setForm(f=>({...f,ticker:e.target.value}))}/>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>평균 매수가 * <span style={{ color:"#445" }}>({form.market==="US"?"$":"₩"})</span></div>
                  <input style={inp} type="number" inputMode="decimal" placeholder={form.market==="US"?"예: 195.00":"예: 72000"} value={form.avgPrice} onChange={e=>setForm(f=>({...f,avgPrice:e.target.value}))}/>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>보유 수량 *</div>
                  <input style={inp} type="number" inputMode="numeric" placeholder="예: 10" value={form.qty} onChange={e=>setForm(f=>({...f,qty:e.target.value}))}/>
                </div>
              </div>
              <div>
                <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>현재가 * <span style={{ color:"#445" }}>(최근 체결가, {form.market==="US"?"$":"₩"})</span></div>
                <input style={inp} type="number" inputMode="decimal" placeholder={form.market==="US"?"예: 213.20":"예: 74500"} value={form.currentPrice} onChange={e=>setForm(f=>({...f,currentPrice:e.target.value}))}/>
              </div>
            </div>
            <div style={{ display:"flex", gap:10, marginTop:18 }}>
              <button style={{ ...btnG, flex:1, padding:"13px" }} onClick={()=>setStockModal(null)}>취소</button>
              <button style={{ ...btnY, flex:2 }} onClick={saveStock}>저장</button>
            </div>
          </div>
        </div>
      )}

      {/* ════ 매매내역 모달 ════ */}
      {tradeModal && (
        <div onClick={()=>setTradeModal(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.78)", zIndex:200, display:"flex", alignItems:"flex-end", backdropFilter:"blur(4px)", WebkitBackdropFilter:"blur(4px)" }}>
          <div className="slide" onClick={e=>e.stopPropagation()} style={{ background:"#0D1220", borderRadius:"20px 20px 0 0", border:`1px solid rgba(255,211,0,.22)`, padding:"22px 20px calc(20px + env(safe-area-inset-bottom))", width:"100%" }}>
            <div style={{ width:36, height:4, background:"#2a3040", borderRadius:2, margin:"0 auto 18px" }}/>
            <div style={{ fontSize:17, fontWeight:700, marginBottom:16 }}>
              매매내역 추가 · {stocks.find(s=>s.id===tradeModal)?.name}
              <span style={{ fontSize:11, color:C.muted, marginLeft:6 }}>({stocks.find(s=>s.id===tradeModal)?.market==="US"?"$ 달러":"₩ 원"})</span>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
              <div><div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>날짜 *</div><input style={inp} type="date" value={tForm.date} onChange={e=>setTForm(f=>({...f,date:e.target.value}))}/></div>
              <div><div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>구분 *</div>
                <select style={sel} value={tForm.type} onChange={e=>setTForm(f=>({...f,type:e.target.value}))}>
                  <option value="buy">매수</option>
                  <option value="sell">매도</option>
                </select>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <div style={{ flex:1 }}><div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>수량 *</div><input style={inp} type="number" inputMode="numeric" placeholder="주" value={tForm.qty} onChange={e=>setTForm(f=>({...f,qty:e.target.value}))}/></div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>단가 * ({stocks.find(s=>s.id===tradeModal)?.market==="US"?"$":"₩"})</div>
                  <input style={inp} type="number" inputMode="decimal" placeholder="단가" value={tForm.price} onChange={e=>setTForm(f=>({...f,price:e.target.value}))}/>
                </div>
              </div>
            </div>
            <div style={{ display:"flex", gap:10, marginTop:18 }}>
              <button style={{ ...btnG, flex:1, padding:"13px" }} onClick={()=>setTradeModal(null)}>취소</button>
              <button style={{ ...btnY, flex:2 }} onClick={saveTrade}>저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
