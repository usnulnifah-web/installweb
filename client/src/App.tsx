import { useEffect, useMemo, useState } from "react";
import { startLogin } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Download,
  Globe2,
  Menu,
  MessageCircle,
  Package,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import RoleDashboard from "./pages/RoleDashboard";

type Product = {
  name: string;
  category: string;
  description: string;
  price: string;
  oldPrice?: string;
  accent: string;
  badge?: string;
  tags: string[];
};
const products: Product[] = [
  {
    name: "NexaStore v2.0",
    category: "Toko Online",
    description: "Landing page olshop modern dengan katalog produk, promo, dan tombol checkout WhatsApp.",
    price: "Rp89K",
    oldPrice: "Rp149K",
    accent: "lime",
    badge: "Best seller",
    tags: ["Responsive", "SEO Ready", "WhatsApp"],
  },
  {
    name: "Provider Dashboard",
    category: "Provider",
    description: "Panel penjualan pulsa dan paket data yang bersih, cepat, dan siap dikustomisasi.",
    price: "Rp129K",
    oldPrice: "Rp199K",
    accent: "violet",
    badge: "New",
    tags: ["Dashboard", "Dark mode", "HTML/CSS"],
  },
  {
    name: "LinkBio Pro",
    category: "Landing Page",
    description: "Halaman link-in-bio premium untuk mengumpulkan semua link bisnis dalam satu tempat.",
    price: "Rp59K",
    accent: "orange",
    tags: ["Minimal", "Fast load", "Easy edit"],
  },
];

const categories = ["Semua", "Toko Online", "Provider", "Landing Page"];

function App() {
  return <SetupGate />;
}

function SetupGate() {
  const setup = trpc.setup.status.useQuery(undefined, { retry: false });
  const auth = useAuth();
  const utils = trpc.useUtils();
  const claim = trpc.setup.claimFirstAdmin.useMutation({
    onSuccess: async () => {
      await utils.setup.status.invalidate();
      await utils.auth.me.invalidate();
    },
  });

  if (setup.isLoading || auth.loading) return <div className="dash-loading"><span className="loading-orb" /> Menyiapkan website...</div>;
  if (setup.data && !setup.data.databaseReady) return <section className="dash-login"><div className="dash-eyebrow">Setup diperlukan</div><h1>Database belum siap.</h1><p>Isi DATABASE_URL di file .env lalu jalankan migrasi sebelum membuka website.</p></section>;
  if (!setup.data?.hasAdmin) return <section className="dash-login"><div className="dash-login-mark"><Code2 size={28} /></div><div className="dash-eyebrow">Setup pertama kali</div><h1>Buat akun admin<br /><em>untuk membuka website.</em></h1><p>Semua halaman dikunci sampai admin pertama berhasil dibuat. Masuk dengan akun Anda untuk mengaktifkan akses website.</p>{auth.user ? <><p>Akun aktif: <strong>{auth.user.name || auth.user.email || "Pengguna"}</strong></p><button className="dash-primary" onClick={() => claim.mutate()} disabled={claim.isPending}>{claim.isPending ? "Membuat admin..." : "Buat akun admin"}</button></> : <button className="dash-primary" onClick={() => startLogin()}>Masuk untuk membuat admin</button>}<small>{claim.error?.message || "Setelah admin dibuat, layar setup ini otomatis dinonaktifkan."}</small></section>;
  return <PublicApp />;
}

function PlacementAd({ ad }: { ad?: { enabled: boolean; client: string; slot: string; placement: string } }) { useEffect(() => { if (!ad?.enabled || !ad.client || !ad.slot) return; const existing = document.querySelector('script[data-scriptstore-ads]'); if (!existing) { const script = document.createElement("script"); script.async = true; script.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"; script.dataset.scriptstoreAds = "true"; document.head.appendChild(script); } }, [ad]); if (!ad?.enabled || !ad.client || !ad.slot) return null; return <div className="category-ad" aria-label="Iklan"><ins className="adsbygoogle" style={{ display: "block" }} data-ad-client={ad.client} data-ad-slot={ad.slot} data-ad-format="auto" data-full-width-responsive="true" /></div>; }

function PublicApp() {
  if (window.location.pathname.startsWith("/dashboard")) return <RoleDashboard />;

  const [activeCategory, setActiveCategory] = useState("Semua");
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [copied, setCopied] = useState(false);
  const site = trpc.site.config.useQuery();
  useEffect(() => { const title = site.data?.seoTitle || "ScriptStore · Script premium siap pakai"; const description = site.data?.seoDescription || "Script web premium siap pakai untuk bisnis digital."; document.title = title; const favicon = site.data?.branding?.faviconUrl; if (favicon) { let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]'); if (!icon) { icon = document.createElement("link"); icon.rel = "icon"; document.head.appendChild(icon); } icon.href = favicon; } let meta = document.querySelector('meta[name="description"]'); if (!meta) { meta = document.createElement("meta"); meta.setAttribute("name", "description"); document.head.appendChild(meta); } meta.setAttribute("content", description); }, [site.data?.seoTitle, site.data?.seoDescription]);

  const visibleProducts = useMemo(
    () => products.filter((product) => {
      const categoryMatch = activeCategory === "Semua" || product.category === activeCategory;
      const queryMatch = `${product.name} ${product.description}`.toLowerCase().includes(query.toLowerCase());
      return categoryMatch && queryMatch;
    }),
    [activeCategory, query],
  );

  const order = (product = "") => {
    const message = product ? `Halo ScriptStore, saya mau order ${product}.` : "Halo ScriptStore, saya mau tanya produk script.";
    window.open(`https://wa.me/6281234567890?text=${encodeURIComponent(message)}`, "_blank");
  };

  const copyCode = async () => {
    await navigator.clipboard?.writeText("SCRIPTSTORE");
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <main className="site-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="nav container">
        <a className="brand" href="#top" aria-label="ScriptStore home">
          <span className="brand-mark"><Code2 size={19} /></span>
          <span>script<span>store</span><small>.id</small></span>
        </a>
        <nav className={`nav-links ${menuOpen ? "is-open" : ""}`}>
          <a href="#produk" onClick={() => setMenuOpen(false)}>Produk</a>
          <a href="#keunggulan" onClick={() => setMenuOpen(false)}>Keunggulan</a>
          <a href="#faq" onClick={() => setMenuOpen(false)}>FAQ</a>
          <a className="nav-dashboard" href="/dashboard" onClick={() => setMenuOpen(false)}>Dashboard</a>
          <button className="nav-order" onClick={() => order()}>Order sekarang <ArrowUpRight size={16} /></button>
        </nav>
        <button className="menu-button" aria-label="Buka menu" onClick={() => setMenuOpen((value) => !value)}>
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
      </header>

      <section className="hero container" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span className="pulse-dot" /> Script siap pakai untuk bisnis digital</div>
          <h1>Bangun toko online.<br /><em>Lebih cepat.</em></h1>
          <p className="hero-text">Koleksi script HTML premium untuk provider, olshop, dan bisnis digital. Tinggal download, edit, lalu publish.</p>
          <div className="hero-actions">
            <a className="primary-button" href="#produk">Lihat katalog <ArrowUpRight size={18} /></a>
            <button className="text-button" onClick={() => order()}>Tanya via WhatsApp <MessageCircle size={17} /></button>
          </div>
          <div className="trust-row"><div className="avatars"><span>R</span><span>A</span><span>D</span><span>+</span></div><span>Dipakai oleh <strong>1.200+</strong> kreator</span></div>
        </div>
        <div className="hero-card-wrap">
          <div className="hero-card">
            <div className="card-top"><span className="mini-label">PREVIEW / 001</span><span className="live"><span /> LIVE</span></div>
            <div className="code-window"><div className="code-line line-wide" /><div className="code-line line-short" /><div className="code-line line-mid" /><div className="code-line line-long" /><div className="code-line line-short" /><div className="code-line line-mid" /></div>
            <div className="preview-bottom"><div><span className="mini-label">YOUR NEXT</span><strong>digital storefront</strong></div><div className="preview-arrow"><ArrowUpRight size={20} /></div></div>
          </div>
          <div className="floating-badge badge-one"><Sparkles size={15} /> Ready to launch</div>
          <div className="floating-badge badge-two"><ShieldCheck size={15} /> Clean code</div>
        </div>
      </section>

      <section className="stats container"><div><strong>40+</strong><span>Script premium</span></div><div><strong>1.2K</strong><span>Pembeli aktif</span></div><div><strong>4.9/5</strong><span>Rating pelanggan</span></div><div><strong>24/7</strong><span>Support order</span></div></section>

      <section className="catalog container" id="produk">
        <div className="section-heading"><div><div className="eyebrow">Katalog pilihan</div><h2>Mulai dari yang kamu <em>butuhkan.</em></h2></div><p>Script clean, responsive, dan mudah dikembangkan.<br />Pilih satu untuk mulai hari ini.</p></div>
        <div className="catalog-tools"><div className="category-tabs">{categories.map((category) => <button key={category} className={activeCategory === category ? "active" : ""} onClick={() => setActiveCategory(category)}>{category}</button>)}</div><label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari script..." /></label></div><PlacementAd ad={site.data?.ads} />
        <div className="product-grid">{visibleProducts.map((product, index) => <>{site.data?.ads?.placement === "middle" && index === Math.ceil(visibleProducts.length / 2) && <div className="product-grid-ad"><PlacementAd ad={site.data?.ads} /></div>}<article className={`product-card accent-${product.accent}`} key={product.name}><div className="product-visual"><div className="visual-glow" /><span className="product-badge">{product.badge || "HTML / CSS / JS"}</span><div className="visual-icon"><Globe2 size={30} /></div><span className="visual-code">&lt;/&gt;</span></div><div className="product-body"><div className="product-category">{product.category}</div><h3>{product.name}</h3><p>{product.description}</p><div className="tag-row">{product.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="product-footer"><div><span className="price">{product.price}</span>{product.oldPrice && <del>{product.oldPrice}</del>}</div><button className="buy-button" onClick={() => order(product.name)}>Beli script <ArrowUpRight size={16} /></button></div></div></article></>)}</div>
        {site.data?.ads?.placement === "bottom" && <PlacementAd ad={site.data?.ads} />}
        {visibleProducts.length === 0 && <div className="empty-state">Script tidak ditemukan. Coba kata kunci atau kategori lain.</div>}
      </section>

      <section className="why-section" id="keunggulan"><div className="container why-grid"><div><div className="eyebrow">Kenapa ScriptStore?</div><h2>Bukan cuma bagus.<br /><em>Benar-benar siap dipakai.</em></h2><p className="section-copy">Kami merancang setiap script untuk membantu kamu launch lebih cepat tanpa mulai dari halaman kosong.</p><button className="outline-button" onClick={() => order()}>Konsultasi gratis <MessageCircle size={16} /></button></div><div className="feature-list"><div className="feature-item"><span><Download size={19} /></span><div><h3>Instant download</h3><p>File langsung dikirim setelah pembayaran dikonfirmasi.</p></div></div><div className="feature-item"><span><Code2 size={19} /></span><div><h3>Clean & editable</h3><p>Struktur kode rapi, mudah diedit bahkan untuk pemula.</p></div></div><div className="feature-item"><span><ShieldCheck size={19} /></span><div><h3>Support setelah beli</h3><p>Butuh bantuan instalasi? Tim kami siap membantu.</p></div></div></div></div></section>

      <section className="faq container" id="faq"><div className="section-heading"><div><div className="eyebrow">Pertanyaan umum</div><h2>Masih <em>penasaran?</em></h2></div><p>Jawaban singkat sebelum kamu<br />memilih script favorit.</p></div><div className="faq-list">{["Apakah script bisa diedit?", "Bagaimana cara menerima file setelah order?", "Apakah bisa request perubahan?", "Bisa dipasang di hosting biasa?"] .map((question, index) => <div className={`faq-item ${openFaq === index ? "open" : ""}`} key={question}><button onClick={() => setOpenFaq(openFaq === index ? null : index)}><span>0{index + 1}</span><strong>{question}</strong><ChevronDown size={18} /></button>{openFaq === index && <p>{index === 0 ? "Bisa. Semua script dibuat dengan HTML, CSS, dan JavaScript yang mudah kamu kembangkan." : index === 1 ? "File dikirim melalui WhatsApp atau email setelah pembayaran dikonfirmasi." : index === 2 ? "Bisa, silakan chat dulu untuk mengecek kebutuhan dan biaya kustomisasi." : "Bisa. Script dapat dipasang di hosting biasa yang mendukung file HTML."}</p>}</div>)}</div></section>

      <section className="cta container"><div><div className="eyebrow">Siap mulai?</div><h2>Jangan biarkan ide bagus<br />menunggu terlalu lama.</h2></div><div className="cta-right"><p>Gunakan kode promo untuk potongan 10% pembelian pertama.</p><button className="promo-code" onClick={copyCode}><span>{copied ? "Tersalin!" : "SCRIPTSTORE"}</span>{copied ? <Check size={16} /> : <Copy size={16} />}</button><button className="primary-button" onClick={() => order()}>Order sekarang <ArrowUpRight size={18} /></button></div></section>
      <footer className="footer container"><a className="brand" href="#top"><span className="brand-mark"><Code2 size={17} /></span><span>script<span>store</span><small>.id</small></span></a><span>© 2025 ScriptStore. Dibuat untuk kreator digital.</span><span className="footer-rating"><Star size={14} fill="currentColor" /> 4.9 dari 5</span></footer>
    </main>
  );
}

export default App;
