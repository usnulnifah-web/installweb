import { FormEvent, useState } from "react";
import { trpc } from "@/lib/trpc";

type Mode = "login" | "register" | "forgot" | "security" | "reset";

export default function LocalAuthPanel({ firstAdmin = false }: { firstAdmin?: boolean }) {
  const utils = trpc.useUtils();
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
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setMessage("");
    try {
      if (mode === "login") await login.mutateAsync({ username: fields.username, password: fields.password });
      if (mode === "register") await register.mutateAsync(fields);
      if (mode === "forgot") await forgot.mutateAsync({ identifier: fields.username });
      if (mode === "security") await securityReset.mutateAsync({ identifier: fields.username, answer: fields.securityAnswer, password: fields.password });
      if (mode === "reset") await reset.mutateAsync({ token, password: fields.password });
    } catch (e) { setError(e instanceof Error ? e.message : "Permintaan gagal."); }
  };
  const busy = login.isPending || register.isPending || forgot.isPending || reset.isPending || securityReset.isPending;
  const title = mode === "login" ? "Masuk ke akun" : mode === "register" ? (firstAdmin ? "Buat admin pertama" : "Buat akun") : mode === "forgot" ? "Reset lewat email" : mode === "security" ? "Reset dengan pertanyaan" : "Password baru";
  return <section className="dash-login"><div className="dash-login-mark">🔐</div><div className="dash-eyebrow">ScriptStore account</div><h1>{title}</h1><p>{mode === "forgot" ? "Masukkan username. Jika akun dan SMTP tersedia, tautan reset dikirim ke email terdaftar." : mode === "security" ? "Jawab pertanyaan keamanan yang dibuat saat pendaftaran." : mode === "reset" ? "Buat password baru minimal 15 karakter." : mode === "register" ? "Gunakan password panjang dan isi pertanyaan keamanan untuk pemulihan." : "Gunakan username dan password untuk melanjutkan."}</p>
    <form onSubmit={submit} className="auth-form">
      {mode === "register" && <><input required value={fields.name} onChange={update("name")} placeholder="Nama lengkap" /><input required type="email" value={fields.email} onChange={update("email")} placeholder="Email terverifikasi" /></>}
      {(mode === "login" || mode === "register" || mode === "forgot" || mode === "security") && <input required value={fields.username} onChange={update("username")} placeholder={mode === "forgot" || mode === "security" ? "Username atau email" : "Username"} />}
      {mode === "security" && <><small>{question.data || "Masukkan username/email untuk melihat pertanyaan."}</small><input required value={fields.securityAnswer} onChange={update("securityAnswer")} placeholder="Jawaban keamanan" /></>}
      {(mode === "login" || mode === "register" || mode === "reset" || mode === "security") && <input required minLength={15} type="password" value={fields.password} onChange={update("password")} placeholder="Password minimal 15 karakter" />}
      {mode === "register" && <><input required value={fields.securityQuestion} onChange={update("securityQuestion")} placeholder="Pertanyaan keamanan" /><input required value={fields.securityAnswer} onChange={update("securityAnswer")} placeholder="Jawaban keamanan" /></>}
      <button className="dash-primary" disabled={busy}>{busy ? "Memproses..." : mode === "login" ? "Masuk" : mode === "register" ? "Daftar" : mode === "forgot" ? "Kirim tautan reset" : mode === "security" ? "Ganti password" : "Simpan password baru"}</button>
    </form>
    {error && <small className="auth-error">{error}</small>}{message && <small>{message}</small>}
    {mode === "login" && <><button className="text-button" onClick={() => setMode("forgot")}>Lupa password lewat email</button><button className="text-button" onClick={() => setMode("security")}>Lupa password lewat pertanyaan keamanan</button></>}
    {mode === "forgot" && <button className="text-button" onClick={() => setMode("security")}>Gunakan pertanyaan keamanan</button>}
    {mode !== "login" && mode !== "reset" && <button className="text-button" onClick={() => setMode("login")}>Kembali ke login</button>}
    {mode === "login" && <button className="text-button" onClick={() => setMode("register")}>Belum punya akun? Daftar</button>}
  </section>;
}
