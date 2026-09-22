import { FormEvent, useState } from "react";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, LockKeyhole, ShieldCheck, Store, UserRound } from "lucide-react";

type Mode = "login" | "register" | "forgot" | "security" | "reset";
type RequiredRole = "admin" | "seller" | "buyer";

const roleCopy = {
  admin: { label: "Administrator", short: "Admin", description: "Kelola user, produk, transaksi, dan pengaturan toko." },
  seller: { label: "Penjual", short: "Penjual", description: "Upload dan kelola produk digital Anda." },
  buyer: { label: "Pembeli", short: "Pembeli", description: "Jelajahi katalog dan akses produk yang dibeli." },
} as const;

export default function LocalAuthPanel({ firstAdmin = false, requiredRole }: { firstAdmin?: boolean; requiredRole?: RequiredRole }) {
  const utils = trpc.useUtils();
  const site = trpc.site.config.useQuery();
  const [mode, setMode] = useState<Mode>(() => new URLSearchParams(window.location.search).has("token") ? "reset" : firstAdmin ? "register" : "login");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [fields, setFields] = useState({ username: "", password: "", name: "", email: "", securityQuestion: "", securityAnswer: "" });
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const question = trpc.auth.securityQuestion.useQuery({ identifier: fields.username }, { enabled: mode === "security" && fields.username.length >= 3, retry: false });
  const login = trpc.auth.login.useMutation({ onSuccess: async () => { await utils.auth.me.invalidate(); } });
  const register = trpc.auth.register.useMutation({ onSuccess: async () => { await utils.auth.me.invalidate(); } });
  const forgot = trpc.auth.forgotPassword.useMutation({ onSuccess: (data) => setMessage(data.message) });
  const reset = trpc.auth.resetPassword.useMutation({ onSuccess: () => { setMessage("Password berhasil diubah. Silakan login."); setMode("login"); window.history.replaceState({}, "", window.location.pathname); } });
  const securityReset = trpc.auth.resetWithSecurityQuestion.useMutation({ onSuccess: () => { setMessage("Password berhasil diubah. Silakan login."); setMode("login"); } });
  const update = (key: keyof typeof fields) => (event: React.ChangeEvent<HTMLInputElement>) => setFields((current) => ({ ...current, [key]: event.target.value }));
  const setAuthMode = (next: Mode) => { setError(""); setMessage(""); setMode(next); };
  const completeAuth = (text: string) => { setMessage(text); window.setTimeout(() => window.location.assign("/dashboard"), 900); };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setMessage("");
    try {
      if (mode === "login") { await login.mutateAsync({ username: fields.username, password: fields.password, expectedRole: requiredRole === "admin" || requiredRole === "seller" ? requiredRole : undefined }); completeAuth(`Login ${copy.short} berhasil. Mengalihkan ke dashboard...`); }
      if (mode === "register") { await register.mutateAsync({ ...fields, requestedRole: requiredRole === "seller" ? "seller" : "buyer" }); completeAuth(`Pendaftaran ${copy.short.toLowerCase()} berhasil. Mengalihkan ke dashboard...`); }
      if (mode === "forgot") await forgot.mutateAsync({ identifier: fields.username });
      if (mode === "security") await securityReset.mutateAsync({ identifier: fields.username, answer: fields.securityAnswer, password: fields.password });
      if (mode === "reset") await reset.mutateAsync({ token, password: fields.password });
    } catch (e) { setError(e instanceof Error ? e.message : "Permintaan gagal."); }
  };
  const busy = login.isPending || register.isPending || forgot.isPending || reset.isPending || securityReset.isPending;
  const scoped = Boolean(requiredRole);
  const copy = requiredRole ? roleCopy[requiredRole] : roleCopy.buyer;
  const title = mode === "login" ? `Masuk sebagai ${copy.short}` : mode === "register" ? `Daftar sebagai ${copy.short}` : mode === "forgot" ? "Pulihkan akun" : mode === "security" ? "Verifikasi keamanan" : "Buat password baru";
  const subtitle = mode === "login" ? copy.description : mode === "register" ? `Buat akun ${copy.short.toLowerCase()} baru dengan aman.` : mode === "forgot" ? "Kami akan membantu memulihkan akses ke akun Anda." : mode === "security" ? "Jawab pertanyaan keamanan lalu buat password baru." : "Gunakan password baru minimal 15 karakter.";
  return <main className="auth-page">
    <div className="auth-glow auth-glow-one" /><div className="auth-glow auth-glow-two" />
    <a className="auth-brand" href="/" aria-label="Kembali ke ScriptStore"><span className="brand-mark"><LockKeyhole size={17} /></span><span>script<span>store</span><small>.id</small></span></a>
    <section className="auth-card">
      <div className="auth-card-head"><span className="auth-icon">{requiredRole === "admin" ? <ShieldCheck size={23} /> : requiredRole === "seller" ? <Store size={23} /> : <UserRound size={23} />}</span><div><span className="auth-kicker">Akses akun</span><strong>{copy.label}</strong></div></div>
      <h1>{title}</h1><p className="auth-subtitle">{subtitle}</p>
      {site.data?.googleLoginEnabled !== false && !scoped && (mode === "login" || mode === "register") && <button type="button" className="auth-social" onClick={() => { window.location.href = "/api/auth/google"; }}>Lanjutkan dengan Google</button>}
      {site.data?.googleLoginEnabled !== false && !scoped && (mode === "login" || mode === "register") && <div className="auth-divider"><span>atau gunakan akun lokal</span></div>}
      <form onSubmit={submit} className="auth-form">
        {mode === "register" && <><label>Nama lengkap<input required value={fields.name} onChange={update("name")} placeholder="Nama lengkap" /></label><label>Email<input required type="email" value={fields.email} onChange={update("email")} placeholder="nama@email.com" /></label></>}
        {(mode === "login" || mode === "register" || mode === "forgot" || mode === "security") && <label>{mode === "forgot" || mode === "security" ? "Username atau email" : "Username"}<input required value={fields.username} onChange={update("username")} placeholder={mode === "forgot" || mode === "security" ? "Username atau email" : "Username"} /></label>}
        {mode === "security" && <><small className="auth-hint">{question.data || "Masukkan username/email untuk melihat pertanyaan."}</small><label>Jawaban keamanan<input required value={fields.securityAnswer} onChange={update("securityAnswer")} placeholder="Jawaban keamanan" /></label></>}
        {(mode === "login" || mode === "register" || mode === "reset" || mode === "security") && <label>Password<input required minLength={15} type="password" value={fields.password} onChange={update("password")} placeholder="Minimal 15 karakter" /></label>}
        {mode === "register" && <><label>Pertanyaan keamanan<input required value={fields.securityQuestion} onChange={update("securityQuestion")} placeholder="Contoh: nama hewan peliharaan" /></label><label>Jawaban keamanan<input required value={fields.securityAnswer} onChange={update("securityAnswer")} placeholder="Jawaban Anda" /></label></>}
        <button className="auth-submit" disabled={busy}>{busy ? "Memproses..." : mode === "login" ? `Masuk sebagai ${copy.short}` : mode === "register" ? `Daftar sebagai ${copy.short}` : mode === "forgot" ? "Kirim pemulihan" : mode === "security" ? "Ganti password" : "Simpan password baru"}</button>
      </form>
      {error && <div className="auth-error"><span>!</span>{error}</div>}{message && <div className="auth-message">{message}</div>}
      {mode === "login" && <div className="auth-actions"><button className="auth-link" onClick={() => setAuthMode("forgot")}>Lupa password?</button><button className="auth-link" onClick={() => setAuthMode("security")}>Gunakan pertanyaan keamanan</button></div>}
      {mode === "forgot" && <button className="auth-link" onClick={() => setAuthMode("security")}>Gunakan pertanyaan keamanan</button>}
      {mode !== "login" && mode !== "reset" && <button className="auth-link" onClick={() => setAuthMode("login")}><ArrowLeft size={14} /> Kembali ke login</button>}
      {mode === "login" && requiredRole !== "admin" && <div className="auth-register-prompt">Belum punya akun? <button className="auth-link inline" onClick={() => setAuthMode("register")}>Daftar sebagai {copy.short.toLowerCase()}</button></div>}
      {mode === "login" && requiredRole === "admin" && <small className="auth-note">Akses admin hanya untuk akun Administrator.</small>}
    </section>
    <p className="auth-footer">Aman, cepat, dan siap digunakan untuk bisnis digital Anda.</p>
  </main>;
}
