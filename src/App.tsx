import { FormEvent, useEffect, useMemo, useState } from "react";
import type { CartItem, Dashboard, DeliveryDraft, DeliveryParserItem, DeliveryParserPreview, EmailStatus, Notification, Order, OrderItem, OrderStatus, Payment, Product, ProviderConfig, ProviderDelivery, ProviderPayout, Role, SystemLog, User, WhatsAppBridgeStatus, WhatsAppInboundMessage } from "./types";

const API_URL = import.meta.env.VITE_API_URL || "";
const money = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
function formatDateTime(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Bogota"
  }).format(new Date(value));
}

function orderLabel(order?: Pick<Order, "id" | "order_number"> | null) {
  return order?.order_number || (order?.id ? `#${order.id.slice(0, 8)}` : "-");
}

function normalizePhoneForCompare(value?: string | null) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (digits.length === 10 && digits.startsWith("3")) return `57${digits}`;
  return digits;
}

const brandLabels: Record<string, string> = {
  netflix: "N",
  disney: "D+",
  hbo: "MAX",
  amazon: "a",
  crunchyroll: "CR",
  paramount: "P+",
  apple: "TV",
  plex: "PX",
  vix: "VX",
  iptv: "IP",
  directv: "GO",
  spotify: "SP"
};

const brandLogos: Record<string, { src?: string; label: string; alt: string; wide?: boolean }> = {
  netflix: { src: "https://cdn.simpleicons.org/netflix/E50914", label: "N", alt: "Netflix" },
  disney: { src: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Disney%2B_logo.svg", label: "D+", alt: "Disney+", wide: true },
  hbo: { src: "https://cdn.simpleicons.org/hbomax/744AD6", label: "MAX", alt: "HBO Max" },
  amazon: { src: "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/primevideo.svg", label: "PV", alt: "Prime Video", wide: true },
  crunchyroll: { src: "https://cdn.simpleicons.org/crunchyroll/F47521", label: "CR", alt: "Crunchyroll" },
  paramount: { src: "https://cdn.simpleicons.org/paramountplus/0064FF", label: "P+", alt: "Paramount+" },
  apple: { src: "https://cdn.simpleicons.org/appletv/111827", label: "TV", alt: "Apple TV" },
  plex: { src: "https://cdn.simpleicons.org/plex/EBAF00", label: "PX", alt: "Plex" },
  vix: { src: "https://commons.wikimedia.org/wiki/Special:Redirect/file/ViX_Logo.svg", label: "VIX", alt: "ViX", wide: true },
  iptv: { label: "IPTV", alt: "IPTV" },
  directv: { src: "https://commons.wikimedia.org/wiki/Special:Redirect/file/DGO-logo.svg", label: "DGO", alt: "DIRECTV GO", wide: true },
  spotify: { src: "https://cdn.simpleicons.org/spotify/1DB954", label: "SP", alt: "Spotify" }
};

const statusLabels: Record<OrderStatus, string> = {
  admin_payment_pending: "Pago admin pendiente",
  provider_delivery_pending: "Pendiente proveedor",
  wallet_pending: "Pendiente legado",
  payout_processing: "Pagando proveedor",
  pending_payment: "Pendiente de pago",
  paid: "Pagado",
  pending: "Pendiente",
  processing: "En proceso",
  delivered: "Entregado",
  payout_failed: "Pago proveedor fallido",
  payment_failed: "Pago fallido",
  cancelled: "Cancelado"
};

type View = "auth" | "catalog" | "cart" | "client" | "provider" | "admin";

function BrandLogo({ brandKey, name, small = false }: { brandKey?: string | null; name: string; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  const logo = brandLogos[brandKey || ""];
  const fallback = logo?.label || brandLabels[brandKey || ""] || name.slice(0, 2).toUpperCase();
  const className = `logo-box${small ? " small" : ""}${logo?.wide ? " wide" : ""}${logo?.src && !failed ? " has-image" : ""}`;

  return (
    <div className={className} aria-label={logo?.alt || name} title={logo?.alt || name}>
      {logo?.src && !failed ? (
        <img src={logo.src} alt={logo.alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span>{fallback}</span>
      )}
    </div>
  );
}

function getDefaultViewByRole(role?: Role): View {
  if (role === "client") return "catalog";
  if (role === "provider") return "provider";
  if (role === "admin") return "admin";
  return "auth";
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [user, setUser] = useState<User | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(null);
  const [whatsappStatus, setWhatsappStatus] = useState<WhatsAppBridgeStatus | null>(null);
  const [whatsappQr, setWhatsappQr] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);
  const [pendingPayouts, setPendingPayouts] = useState<ProviderPayout[]>([]);
  const [pendingDeliveryOrders, setPendingDeliveryOrders] = useState<Order[]>([]);
  const [providerDeliveries, setProviderDeliveries] = useState<ProviderDelivery[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [deliveryDrafts, setDeliveryDrafts] = useState<DeliveryDraft[]>([]);
  const [whatsappInboundMessages, setWhatsappInboundMessages] = useState<WhatsAppInboundMessage[]>([]);
  const [adminLogs, setAdminLogs] = useState<SystemLog[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [view, setView] = useState<View>(token ? "auth" : "auth");
  const [selectedAddedProduct, setSelectedAddedProduct] = useState<Product | null>(null);
  const [addedDetailOpen, setAddedDetailOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);

  useEffect(() => {
    if (token) loadMe(token);
  }, []);

  useEffect(() => {
    if (!user || !token) return;
    if (user.role === "client") {
      loadProducts();
      refreshClientData();
    }
    if (user.role === "provider") refreshProviderData();
    if (user.role === "admin") refreshAdminData();
    if (user.role === "admin") {
      loadProducts();
    }
  }, [user, token]);

  useEffect(() => {
    if (!user || !token || user.role !== "provider") return;
    refreshProviderData();
    const interval = window.setInterval(() => {
      const activeElement = document.activeElement;
      const skipOrders = activeElement instanceof HTMLElement && Boolean(activeElement.closest(".delivery-form"));
      refreshProviderData({ skipOrders });
    }, 5000);
    return () => window.clearInterval(interval);
  }, [user, token]);

  useEffect(() => {
    if (!user || !token || user.role !== "admin") return;
    refreshAdminData();
    const interval = window.setInterval(refreshAdminData, 10000);
    return () => window.clearInterval(interval);
  }, [user, token]);

  useEffect(() => {
    if (!user || !token || user.role !== "client") return;
    refreshClientData();
    const interval = window.setInterval(refreshClientData, 5000);
    return () => window.clearInterval(interval);
  }, [user, token]);

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || "No se pudo completar la solicitud");
    return data as T;
  }

  async function loadProducts() {
    const data = await request<{ products: Product[] }>(user?.role === "admin" ? "/api/admin/products" : "/api/products");
    setProducts(data.products);
  }

  async function loadMe(activeToken = token) {
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${activeToken}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.error);
      setUser(data.user);
      setView(getDefaultViewByRole(data.user.role));
    } catch {
      logout();
    }
  }

  async function loadOrders() {
    const data = await request<{ orders: Order[] }>("/api/orders");
    setOrders(normalizeOrders(data.orders));
  }

  async function loadDashboard() {
    const data = await request<{ kpis: Omit<Dashboard, "recentOrders" | "movements" | "latestPayments" | "providerPayouts" | "monthlyStatements">; recentOrders: Order[]; latestPayments: Payment[]; providerPayouts: ProviderPayout[]; monthlyStatements: Dashboard["monthlyStatements"]; movements: Dashboard["movements"] }>("/api/admin/dashboard");
    setDashboard({ ...data.kpis, recentOrders: normalizeOrders(data.recentOrders), latestPayments: data.latestPayments || [], providerPayouts: data.providerPayouts || [], monthlyStatements: data.monthlyStatements || [], movements: data.movements });
  }

  async function loadUsers() {
    const data = await request<{ users: User[] }>("/api/admin/users");
    setUsers(data.users);
  }

  async function loadProviderConfig() {
    const data = await request<{ config: ProviderConfig }>("/api/admin/provider-config");
    setProviderConfig(data.config);
  }

  async function loadWhatsAppStatus() {
    if (user?.role !== "admin") return;
    const data = await request<{ status: WhatsAppBridgeStatus }>("/api/admin/whatsapp/status");
    setWhatsappStatus(data.status);
    if (data.status.qrPending) {
      const qrData = await request<{ qr: string | null }>("/api/admin/whatsapp/qr");
      setWhatsappQr(qrData.qr);
    } else {
      setWhatsappQr(null);
    }
  }

  async function loadEmailStatus() {
    if (user?.role !== "admin") return;
    const data = await request<{ status: EmailStatus }>("/api/admin/email/status");
    setEmailStatus(data.status);
  }

  async function loadPendingPayouts() {
    if (user?.role !== "admin") return;
    const data = await request<{ payouts: ProviderPayout[] }>("/api/admin/payouts/pending");
    setPendingPayouts(data.payouts || []);
  }

  async function loadPendingDeliveryOrders() {
    if (user?.role !== "admin") return;
    const data = await request<{ orders: Order[] }>("/api/admin/orders/pending-delivery");
    setPendingDeliveryOrders(normalizeOrders(data.orders || []));
  }

  async function loadDeliveryDrafts() {
    if (user?.role !== "admin") return;
    const data = await request<{ drafts: DeliveryDraft[] }>("/api/admin/delivery-drafts");
    setDeliveryDrafts(data.drafts || []);
  }

  async function loadWhatsAppInbound() {
    if (user?.role !== "admin") return;
    const data = await request<{ messages: WhatsAppInboundMessage[] }>("/api/admin/whatsapp/inbound");
    setWhatsappInboundMessages(data.messages || []);
  }

  async function loadAdminLogs() {
    if (user?.role !== "admin") return;
    const data = await request<{ logs: SystemLog[] }>("/api/admin/logs");
    setAdminLogs(data.logs || []);
  }

  async function loadProviderDeliveries() {
    if (user?.role !== "provider") return;
    const data = await request<{ deliveries: ProviderDelivery[] }>("/api/provider/deliveries");
    setProviderDeliveries(data.deliveries || []);
  }

  async function loadNotifications() {
    if (user?.role !== "client") return;
    const data = await request<{ notifications: Notification[] }>("/api/notifications");
    setNotifications(data.notifications || []);
  }

  async function loadUnreadNotifications() {
    if (user?.role !== "client") return;
    const data = await request<{ count: number }>("/api/notifications/unread-count");
    setUnreadNotifications(data.count || 0);
  }

  async function refreshClientData() {
    await Promise.all([loadOrders(), loadNotifications(), loadUnreadNotifications()]);
  }

  async function refreshProviderData(options: { skipOrders?: boolean } = {}) {
    await Promise.all([options.skipOrders ? Promise.resolve() : loadOrders(), loadProviderDeliveries()]);
  }

  async function refreshAdminData() {
    await Promise.all([loadDashboard(), loadOrders(), loadUsers(), loadProducts(), loadProviderConfig(), loadPendingPayouts(), loadPendingDeliveryOrders(), loadWhatsAppStatus(), loadEmailStatus(), loadDeliveryDrafts(), loadWhatsAppInbound(), loadAdminLogs()]);
  }

  function addToCart(product: Product) {
    if (user?.role !== "client") {
      setNotice("Solo los clientes pueden agregar servicios al carrito.");
      return;
    }
    setCart((current) => {
      const existing = current.find((item) => item.product.id === product.id);
      if (existing) return current.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      return [...current, { product, quantity: 1 }];
    });
    setSelectedAddedProduct(product);
    setAddedDetailOpen(true);
  }

  function changeQuantity(productId: string, delta: number) {
    setCart((current) =>
      current
        .map((item) => item.product.id === productId ? { ...item, quantity: item.quantity + delta } : item)
        .filter((item) => item.quantity > 0)
    );
  }

  function removeFromCart(productId: string) {
    setCart((current) => current.filter((item) => item.product.id !== productId));
  }

  async function checkout() {
    if (!user) {
      setNotice("Inicia sesion o crea una cuenta para confirmar la compra.");
      setView("auth");
      return;
    }
    if (user.role !== "client") {
      setNotice("Este flujo de compra solo esta disponible para clientes.");
      return;
    }
    if (!cart.length) return;
    setBusy(true);
    try {
      const result = await request<{ order: Order; message: string }>("/api/orders", {
        method: "POST",
        body: JSON.stringify({ items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity })) })
      });
      setCart([]);
      setNotice(result.message || "Pedido creado correctamente. Estamos procesando tu solicitud.");
      await refreshClientData();
      setView("client");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Error creando el pedido");
    } finally {
      setBusy(false);
    }
  }

  async function authSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const payload = {
        access_code: String(form.get("access_code") || "")
      };
      const data = await request<{ token: string; user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
      localStorage.setItem("token", data.token);
      setToken(data.token);
      setUser(data.user);
      setView(getDefaultViewByRole(data.user.role));
      setNotice(`Sesion activa como ${data.user.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo iniciar sesion");
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    localStorage.removeItem("token");
    setToken("");
    setUser(null);
    setOrders([]);
    setDashboard(null);
    setCart([]);
    setAddedDetailOpen(false);
    setSelectedAddedProduct(null);
    setView("auth");
  }

  async function deliver(orderId: string, item: OrderItem, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await request(`/api/orders/${orderId}/deliveries`, {
        method: "POST",
        body: JSON.stringify({
          order_item_id: item.id,
          product_id: item.product_id,
          delivered_email: form.get("delivered_email"),
          delivered_password: form.get("delivered_password"),
          profile_name: form.get("profile_name"),
          pin: form.get("pin"),
          notes: form.get("notes")
        })
      });
      event.currentTarget.reset();
      setNotice("Cuenta cargada y asociada al cliente.");
      if (user?.role === "provider") await refreshProviderData();
      if (user?.role === "admin") await refreshAdminData();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo cargar la cuenta");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(orderId: string, status: OrderStatus) {
    await request(`/api/orders/${orderId}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    if (user?.role === "provider") await refreshProviderData();
    if (user?.role === "admin") await refreshAdminData();
  }

  async function saveOrderEdit(orderId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await request(`/api/admin/orders/${orderId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: form.get("status"),
        sale_total: Number(form.get("sale_total") || 0),
        provider_total: Number(form.get("provider_total") || 0),
        profit_total: Number(form.get("profit_total") || 0),
        payout_status: form.get("payout_status")
      })
    });
    setNotice("Pedido actualizado.");
    await refreshAdminData();
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>, product?: Product) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      name: form.get("name"),
      description: form.get("description"),
      category: form.get("category"),
      price: Number(form.get("price")),
      provider_cost: Number(form.get("provider_cost") || 0),
      active: form.get("active") === "on",
      brand_key: form.get("brand_key"),
      duration: form.get("duration"),
      screens: form.get("screens"),
      content_type: form.get("content_type"),
      benefits: String(form.get("benefits") || "").split("\n").map((item) => item.trim()).filter(Boolean)
    };
    const path = product ? `/api/admin/products/${product.id}` : "/api/admin/products";
    await request(path, { method: product ? "PATCH" : "POST", body: JSON.stringify(payload) });
    event.currentTarget.reset();
    await refreshAdminData();
  }

  async function saveProviderConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data = await request<{ config: ProviderConfig }>("/api/admin/provider-config", {
      method: "PATCH",
      body: JSON.stringify({
        provider_name: form.get("provider_name"),
        provider_whatsapp_number: form.get("provider_whatsapp_number"),
        admin_notification_phone: form.get("admin_notification_phone"),
        admin_notification_email: form.get("admin_notification_email"),
        provider_notifications_active: form.get("provider_notifications_active") === "on",
        provider_notification_method: form.get("provider_notification_method"),
        provider_payment_method: form.get("provider_payment_method"),
        provider_payment_phone: form.get("provider_payment_phone"),
        provider_document: form.get("provider_document"),
        provider_payment_active: form.get("provider_payment_active") === "on"
      })
    });
    setProviderConfig(data.config);
    setNotice("Configuracion privada del proveedor actualizada.");
    await refreshAdminData();
  }

  async function saveAdminNotificationConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data = await request<Pick<ProviderConfig, "admin_notification_phone" | "admin_notification_email">>("/api/admin/admin-notification-config", {
      method: "PATCH",
      body: JSON.stringify({
        admin_notification_phone: form.get("admin_notification_phone"),
        admin_notification_email: form.get("admin_notification_email")
      })
    });
    setProviderConfig((current) => ({ ...(current || ({} as ProviderConfig)), ...data }));
    setNotice("Destinos de WhatsApp y correo actualizados.");
    await refreshAdminData();
  }

  async function saveEmailConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      const data = await request<{ status: EmailStatus }>("/api/admin/email/config", {
        method: "PATCH",
        body: JSON.stringify({
          host: form.get("smtp_host"),
          port: Number(form.get("smtp_port") || 587),
          secure: form.get("smtp_secure") === "true",
          user: form.get("smtp_user"),
          password: form.get("smtp_password"),
          from: form.get("smtp_from")
        })
      });
      setEmailStatus(data.status);
      setNotice("Configuracion SMTP guardada de forma cifrada.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo guardar la configuracion SMTP.");
    }
  }

  async function testAdminEmail() {
    try {
      const data = await request<{ status: EmailStatus; message: string }>("/api/admin/email/test", { method: "POST" });
      setEmailStatus(data.status);
      setNotice(data.message || "Correo de prueba enviado.");
      await loadAdminLogs();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo enviar el correo de prueba.");
      await loadEmailStatus();
    }
  }

  async function retryWhatsAppFailed() {
    const data = await request<{ status: WhatsAppBridgeStatus }>("/api/admin/whatsapp/retry-failed", { method: "POST" });
    setWhatsappStatus(data.status);
    setNotice("Mensajes fallidos reenviados a cola.");
    await refreshAdminData();
  }

  async function connectWhatsApp() {
    try {
      const data = await request<{ status: WhatsAppBridgeStatus; message: string }>("/api/admin/whatsapp/connect", { method: "POST" });
      setWhatsappStatus(data.status);
      setNotice(data.message || "Vinculacion de WhatsApp iniciada.");
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        const current = await request<{ status: WhatsAppBridgeStatus }>("/api/admin/whatsapp/status");
        setWhatsappStatus(current.status);
        if (current.status.qrPending) {
          const qrData = await request<{ qr: string | null }>("/api/admin/whatsapp/qr");
          setWhatsappQr(qrData.qr);
        }
        if (current.status.qrPending || current.status.connection === "connected" || current.status.lastError) break;
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo iniciar la vinculacion.");
    }
  }

  async function disconnectWhatsApp() {
    const data = await request<{ status: WhatsAppBridgeStatus }>("/api/admin/whatsapp/disconnect", { method: "POST" });
    setWhatsappStatus(data.status);
    setWhatsappQr(null);
    setNotice("Sesion de WhatsApp Bridge desconectada.");
    await refreshAdminData();
  }

  async function testAdminWhatsApp() {
    try {
      const data = await request<{ status: WhatsAppBridgeStatus; message: string }>("/api/admin/whatsapp/test", { method: "POST" });
      setWhatsappStatus(data.status);
      setNotice(data.message || "Mensaje de prueba agregado a la cola.");
      await new Promise((resolve) => window.setTimeout(resolve, 5500));
      await refreshAdminData();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo enviar la prueba de WhatsApp.");
    }
  }

  async function markReceiptSent(payout: ProviderPayout) {
    const reference = window.prompt("Referencia del pago manual (opcional)") || "";
    const notes = window.prompt("Nota del comprobante enviado (opcional)") || "";
    await request(`/api/admin/payouts/${payout.id}/mark-receipt-sent`, {
      method: "PATCH",
      body: JSON.stringify({ admin_payment_reference: reference, admin_payment_notes: notes })
    });
    setNotice("Comprobante marcado como enviado. El pedido fue liberado al proveedor.");
    await refreshAdminData();
  }

  async function cancelPayout(payout: ProviderPayout) {
    await request(`/api/admin/payouts/${payout.id}/cancel`, { method: "PATCH" });
    setNotice("Pedido cancelado.");
    await refreshAdminData();
  }

  async function approveDeliveryDraft(draft: DeliveryDraft) {
    const orderId = window.prompt("Numero de orden para aprobar", draft.order?.order_number || draft.order_id || draft.parsed_data.orderHint || "") || "";
    await request(`/api/admin/delivery-drafts/${draft.id}/approve`, {
      method: "PATCH",
      body: JSON.stringify({ order_id: orderId || undefined })
    });
    setNotice("Borrador aprobado y cuenta agregada al pedido.");
    await refreshAdminData();
  }

  async function rejectDeliveryDraft(draft: DeliveryDraft) {
    const reviewNotes = window.prompt("Motivo del rechazo (opcional)") || "";
    await request(`/api/admin/delivery-drafts/${draft.id}/reject`, {
      method: "PATCH",
      body: JSON.stringify({ review_notes: reviewNotes })
    });
    setNotice("Borrador rechazado.");
    await refreshAdminData();
  }

  async function previewDeliveryMessage(orderId: string | undefined, rawText: string) {
    const order = pendingDeliveryOrders.find((item) => item.id === orderId);
    const data = await request<{ preview: DeliveryParserPreview; order: Order }>("/api/admin/delivery-parser/preview", {
      method: "POST",
      body: JSON.stringify({ orderNumber: order?.order_number, orderId, rawText })
    });
    await refreshAdminData();
    return { preview: data.preview, order: data.order };
  }

  async function approveParsedDelivery(orderId: string, rawText: string, items: DeliveryParserItem[]) {
    const order = pendingDeliveryOrders.find((item) => item.id === orderId);
    await request("/api/admin/delivery-parser/approve", {
      method: "POST",
      body: JSON.stringify({ orderNumber: order?.order_number, orderId, rawText, items })
    });
    setNotice("Cuentas aprobadas y entregadas al cliente.");
    await refreshAdminData();
  }

  async function saveDeliveryDraft(orderId: string, rawText: string, preview: DeliveryParserPreview) {
    const order = pendingDeliveryOrders.find((item) => item.id === orderId);
    await request("/api/admin/delivery-parser/draft", {
      method: "POST",
      body: JSON.stringify({ orderNumber: order?.order_number, orderId, rawText, preview })
    });
    setNotice("Borrador de entrega guardado.");
    await refreshAdminData();
  }

  async function markNotificationRead(notificationId: string) {
    await request(`/api/notifications/${notificationId}/read`, { method: "PATCH" });
    await refreshClientData();
  }

  function copy(text?: string | null) {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setNotice("Dato copiado al portapapeles.");
  }

  return (
    <>
      <AmbientBackground />
      {user && <nav className="navbar">
        <button className="brand-logo" onClick={() => setView(user ? getDefaultViewByRole(user.role) : "auth")}>
          <span className="logo-mark" />
          CENTRO DIGITAL
        </button>
        <div className="nav-actions">
          {!user && <>
            <button className={view === "auth" ? "nav-pill active" : "nav-pill"} onClick={() => setView("auth")}>Ingresar</button>
          </>}
          {user?.role === "client" && <>
            <button className={view === "catalog" ? "nav-pill active" : "nav-pill"} onClick={() => setView("catalog")}>Tienda</button>
            <button className={view === "cart" ? "cart-button active" : "cart-button"} onClick={() => setView("cart")}>Carrito <strong>{cartCount}</strong></button>
            <button className={view === "client" ? "nav-pill active" : "nav-pill"} onClick={() => setView("client")}>Mis cuentas</button>
          </>}
          {user?.role === "provider" && <>
            <button className={view === "provider" ? "nav-pill active" : "nav-pill"} onClick={() => setView("provider")}>Pedidos en vivo</button>
          </>}
          {user?.role === "admin" && <>
            <button className={view === "admin" ? "nav-pill active" : "nav-pill"} onClick={() => setView("admin")}>Dashboard</button>
          </>}
          {user && <button className="nav-status" onClick={logout}><span className="pulse-dot" /> Cerrar sesion</button>}
        </div>
      </nav>}

      {notice && <button className="notice" onClick={() => setNotice("")}>{notice}</button>}

      {view === "auth" && <AuthLanding authSubmit={authSubmit} busy={busy} />}
      {view === "catalog" && user?.role === "client" && <Catalog products={products} addToCart={addToCart} />}
      {view === "cart" && user?.role === "client" && <CartPage cart={cart} total={cartTotal} changeQuantity={changeQuantity} removeFromCart={removeFromCart} checkout={checkout} busy={busy} onContinueShopping={() => setView("catalog")} />}
      {view === "client" && user?.role === "client" && <ClientPanel orders={orders} notifications={notifications} unreadNotifications={unreadNotifications} markNotificationRead={markNotificationRead} copy={copy} />}
      {view === "provider" && user?.role === "provider" && <ProviderPanel orders={orders} deliveries={providerDeliveries} deliver={deliver} busy={busy} />}
      {view === "admin" && user?.role === "admin" && <AdminPanel dashboard={dashboard} users={users} products={products} orders={orders} pendingDeliveryOrders={pendingDeliveryOrders} pendingPayouts={pendingPayouts} providerConfig={providerConfig} whatsappStatus={whatsappStatus} whatsappQr={whatsappQr} emailStatus={emailStatus} adminLogs={adminLogs} saveProduct={saveProduct} saveProviderConfig={saveProviderConfig} saveAdminNotificationConfig={saveAdminNotificationConfig} saveEmailConfig={saveEmailConfig} testAdminEmail={testAdminEmail} connectWhatsApp={connectWhatsApp} retryWhatsAppFailed={retryWhatsAppFailed} disconnectWhatsApp={disconnectWhatsApp} testAdminWhatsApp={testAdminWhatsApp} markReceiptSent={markReceiptSent} previewDeliveryMessage={previewDeliveryMessage} approveParsedDelivery={approveParsedDelivery} saveDeliveryDraft={saveDeliveryDraft} updateStatus={updateStatus} saveOrderEdit={saveOrderEdit} copy={copy} />}

      <AddedProductModal
        product={selectedAddedProduct}
        open={addedDetailOpen}
        quantity={selectedAddedProduct ? cart.find((item) => item.product.id === selectedAddedProduct.id)?.quantity || 0 : 0}
        onQuantityChange={(delta) => selectedAddedProduct && changeQuantity(selectedAddedProduct.id, delta)}
        onContinueShopping={() => {
          setAddedDetailOpen(false);
          setSelectedAddedProduct(null);
          setView("catalog");
        }}
        onGoToCart={() => {
          setAddedDetailOpen(false);
          setSelectedAddedProduct(null);
          setView("cart");
        }}
      />

      {user && <footer className="footer">
        <p><strong>CENTRO DIGITAL DE DISENO</strong> &copy; 2026. PLATAFORMA DE GESTION DE ACTIVOS.</p>
      </footer>}
    </>
  );
}

function AmbientBackground() {
  return (
    <div className="ambient-background">
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />
    </div>
  );
}

function AuthLanding({ authSubmit, busy }: {
  authSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
}) {
  return (
    <main className="auth-landing page-shell">
      <section className="auth-copy">
        <h1>Centro digital de diseño <span>Administrador de cuentas</span></h1>
      </section>
      <AuthCard authSubmit={authSubmit} busy={busy} />
    </main>
  );
}

function Catalog(props: {
  products: Product[];
  addToCart: (product: Product) => void;
}) {
  const categories = [...new Set(props.products.map((product) => product.category))];

  function moveLight(event: React.MouseEvent<HTMLElement>) {
    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    card.style.setProperty("--mouse-x", `${event.clientX - rect.left}px`);
    card.style.setProperty("--mouse-y", `${event.clientY - rect.top}px`);
  }

  return (
    <>
      <header className="hero">
        <h1>Infraestructura <span>Digital</span></h1>
        <p>Catalogo de cuentas premium con compra por carrito, notificacion interna al proveedor y entrega privada por panel.</p>
        <div className="auto-badge">Sistema de envio automatico 24/7</div>
      </header>
      <main className="page-shell">
        <section className="catalog-toolbar">
          <div>
            <span className="eyebrow">Servicios activos</span>
            <h2>{props.products.length} productos listos</h2>
          </div>
          <div className="category-strip">{categories.map((category) => <span key={category}>{category}</span>)}</div>
        </section>
        <section className="layout-two">
          <div className="grid-container">
            {props.products.map((product) => (
              <article className={`smart-card ${product.brand_key}`} key={product.id} onMouseMove={moveLight}>
                <div className="card-inner">
                  <div className="card-header">
                    <BrandLogo brandKey={product.brand_key} name={product.name} />
                    <div className="price-block">
                      <span className="price">{money.format(product.price)}</span>
                      <span className="period">Mensual</span>
                    </div>
                  </div>
                  <h3 className="service-title">{product.name}</h3>
                  <p className="service-desc">{product.description}</p>
                  <div className="specs">
                    <div className="spec-row"><span className="spec-label">Entrega</span><span className="spec-val auto-delivery">Panel privado</span></div>
                    <div className="spec-row"><span className="spec-label">Duracion</span><span className="spec-val">{product.duration || "Segun plan"}</span></div>
                    <div className="spec-row"><span className="spec-label">Pantallas</span><span className="spec-val">{product.screens || "Segun configuracion"}</span></div>
                    <div className="spec-row"><span className="spec-label">Categoria</span><span className="spec-val">{product.category}</span></div>
                  </div>
                  <button className="btn-interact" onClick={() => props.addToCart(product)}>Agregar al carrito <span>+</span></button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

function AuthCard({ authSubmit, busy }: {
  authSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
}) {
  return (
    <aside className="glass-panel auth-panel">
      <form className="form-stack" onSubmit={authSubmit}>
        <input name="access_code" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="Codigo de 4 digitos" required />
        <button className="btn-solid" disabled={busy}>{busy ? "Validando..." : "Ingresar"}</button>
      </form>
    </aside>
  );
}

function AddedProductModal({ product, open, quantity, onQuantityChange, onContinueShopping, onGoToCart }: {
  product: Product | null;
  open: boolean;
  quantity: number;
  onQuantityChange: (delta: number) => void;
  onContinueShopping: () => void;
  onGoToCart: () => void;
}) {
  if (!open || !product) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <article className={`added-modal ${product.brand_key}`}>
        <div className="added-hero">
          <BrandLogo brandKey={product.brand_key} name={product.name} />
          <div className="price-block">
            <span className="price">{money.format(product.price)}</span>
            <span className="period">{product.duration || "Servicio digital"}</span>
          </div>
        </div>
        <div className="panel-title">
          <span className="eyebrow">Servicio agregado</span>
          <h2>{product.name}</h2>
        </div>
        <p className="detail-message">Este servicio fue agregado al carrito. Puedes seguir agregando mas servicios o revisar tu pedido antes de confirmar.</p>
        <p className="service-desc large">{product.description}</p>
        <div className="detail-specs">
          <div><span>Duracion</span><strong>{product.duration || "Segun plan"}</strong></div>
          <div><span>Pantallas / perfiles</span><strong>{product.screens || "Segun configuracion"}</strong></div>
          <div><span>Categoria</span><strong>{product.category}</strong></div>
          <div><span>Contenido</span><strong>{product.content_type || "Entretenimiento digital"}</strong></div>
        </div>
        <div className="benefits-box">
          <strong>Incluye</strong>
          <ul>
            {(product.benefits?.length ? product.benefits : ["Entrega por panel privado.", "Servicio gestionado por proveedor autorizado.", "Acceso segun disponibilidad del plan."]).map((benefit) => (
              <li key={benefit}>{benefit}</li>
            ))}
          </ul>
        </div>
        <div className="added-quantity">
          <div>
            <span className="eyebrow">Cantidad en carrito</span>
            <strong>{quantity} cuenta{quantity === 1 ? "" : "s"}</strong>
            <small>Total de este servicio: {money.format(product.price * quantity)}</small>
          </div>
          <div className="qty modal-qty">
            <button onClick={() => onQuantityChange(-1)} disabled={quantity <= 1}>-</button>
            <span>{quantity}</span>
            <button onClick={() => onQuantityChange(1)}>+</button>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onContinueShopping}>Seguir agregando servicios</button>
          <button className="btn-solid" onClick={onGoToCart}>Ir al carrito</button>
        </div>
      </article>
    </div>
  );
}

function CartPage({ cart, total, changeQuantity, removeFromCart, checkout, busy, onContinueShopping }: {
  cart: CartItem[];
  total: number;
  changeQuantity: (productId: string, delta: number) => void;
  removeFromCart: (productId: string) => void;
  checkout: () => void;
  busy: boolean;
  onContinueShopping: () => void;
}) {
  return (
    <main className="page-shell panel-page">
      <SectionTitle eyebrow="Resumen previo" title="Carrito de servicios" />
      <section className="cart-page-grid">
        <div className="glass-panel cart-summary">
          {cart.length === 0 && <p className="empty">Aun no hay productos seleccionados. Vuelve al catalogo para agregar servicios antes de confirmar.</p>}
          {cart.map((item) => (
            <article className={`cart-summary-row ${item.product.brand_key}`} key={item.product.id}>
              <BrandLogo brandKey={item.product.brand_key} name={item.product.name} small />
              <div className="cart-product-info">
                <strong>{item.product.name}</strong>
                <span>{item.product.duration || "Servicio digital"} - {item.product.screens || "Segun configuracion"}</span>
                <p>{item.product.description}</p>
              </div>
              <div className="cart-money">
                <span>Unitario</span>
                <strong>{money.format(item.product.price)}</strong>
              </div>
              <div className="qty">
                <button onClick={() => changeQuantity(item.product.id, -1)}>-</button>
                <span>{item.quantity}</span>
                <button onClick={() => changeQuantity(item.product.id, 1)}>+</button>
              </div>
              <div className="cart-money">
                <span>Subtotal</span>
                <strong>{money.format(item.product.price * item.quantity)}</strong>
              </div>
              <button className="remove-button" onClick={() => removeFromCart(item.product.id)}>Eliminar</button>
            </article>
          ))}
        </div>
        <aside className="glass-panel checkout-panel">
          <SectionTitle eyebrow="Confirmacion" title="Pedido" compact />
          <div className="checkout-lines">
            {cart.map((item) => (
              <div key={item.product.id}>
                <span>{item.quantity} x {item.product.name}</span>
                <strong>{money.format(item.product.price * item.quantity)}</strong>
              </div>
            ))}
            <div className="checkout-total">
              <span>Total general</span>
              <strong>{money.format(total)}</strong>
            </div>
          </div>
          <p className="hint">Al confirmar, el pedido se creara en la base de datos y el proveedor sera notificado internamente.</p>
          <button className="btn-ghost" onClick={onContinueShopping}>Seguir agregando servicios</button>
          <button className="btn-solid" onClick={checkout} disabled={busy || !cart.length}>{busy ? "Creando pedido..." : "Confirmar pedido"}</button>
        </aside>
      </section>
    </main>
  );
}

function normalizeOrders(orders: any[]): Order[] {
  return orders.map((order) => {
    const deliveries = order.deliveries || [];
    return {
      ...order,
      items: (order.items || []).map((item: any) => ({
        ...item,
        delivered_accounts: deliveries.filter((account: any) => account.order_item_id === item.id)
      }))
    };
  });
}

function ClientPanel({ orders, notifications, unreadNotifications, markNotificationRead, copy }: {
  orders: Order[];
  notifications: Notification[];
  unreadNotifications: number;
  markNotificationRead: (notificationId: string) => void;
  copy: (text?: string | null) => void;
}) {
  const [deliverySearch, setDeliverySearch] = useState("");
  const [accountsModalOrder, setAccountsModalOrder] = useState<Order | null>(null);
  const deliveries = orders.flatMap((order) =>
    order.items.flatMap((item) =>
      item.delivered_accounts.map((account) => {
        const unitValue = item.unit_price || (item.subtotal && item.quantity ? Math.round(item.subtotal / item.quantity) : 0);
        return { order, item, account, unitValue };
      })
    )
  ).sort((a, b) => new Date(b.account.delivered_at).getTime() - new Date(a.account.delivered_at).getTime());
  const deliveredTotal = deliveries.reduce((sum, delivery) => sum + delivery.unitValue, 0);
  const normalizedSearch = deliverySearch.trim().toLowerCase();
  const filteredDeliveries = normalizedSearch
    ? deliveries.filter(({ order, item, account }) =>
        [order.id, order.order_number, item.product_name, account.delivered_email, account.profile_name, account.notes]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedSearch))
      )
    : deliveries;
  return (
    <main className="page-shell panel-page">
      <SectionTitle eyebrow="Panel cliente" title="Pedidos y cuentas entregadas" />
      <div className="dashboard-grid">
        <Metric label="Pedidos" value={orders.length} />
        <Metric label="Pendientes" value={orders.filter((order) => order.status !== "delivered" && order.status !== "cancelled").length} />
        <Metric label="Entregados" value={orders.filter((order) => order.status === "delivered").length} />
        <Metric label="Notificaciones" value={unreadNotifications} />
        <Metric label="Cuentas disponibles" value={deliveries.length} />
        <Metric label="Valor entregado" value={money.format(deliveredTotal)} />
      </div>
      <div className="split-panels">
        <ClientOrderTable orders={orders} onOpenAccounts={setAccountsModalOrder} />
        <section className="glass-panel delivered-accounts-panel">
          <SectionTitle eyebrow="Privado" title="Mis cuentas entregadas" compact />
          <div className="delivered-toolbar">
            <div>
              <strong>{filteredDeliveries.length} de {deliveries.length} cuentas</strong>
              <span>Total entregado: {money.format(deliveredTotal)}</span>
            </div>
            <input value={deliverySearch} onChange={(event) => setDeliverySearch(event.target.value)} placeholder="Buscar por servicio, correo, perfil o pedido" />
          </div>
          <div className="table-scroll delivered-table">
            <table>
              <thead>
                <tr><th>Orden</th><th>Compra</th><th>Entrega</th><th>Servicio</th><th>Valor</th><th>Correo / usuario</th><th>Contrasena</th><th>Perfil</th><th>PIN</th><th>Notas</th></tr>
              </thead>
              <tbody>
                {filteredDeliveries.map(({ order, item, account, unitValue }) => (
                  <tr key={account.id}>
                    <td>{orderLabel(order)}</td>
                    <td>{formatDateTime(order.created_at)}</td>
                    <td>{formatDateTime(account.delivered_at)}</td>
                    <td>{item.product_name}</td>
                    <td>{money.format(unitValue)}</td>
                    <td><button className="table-copy" onClick={() => copy(account.delivered_email)}>{account.delivered_email || "-"}</button></td>
                    <td><button className="table-copy" onClick={() => copy(account.delivered_password)}>Copiar</button></td>
                    <td>{account.profile_name ? <button className="table-copy" onClick={() => copy(account.profile_name || "")}>{account.profile_name}</button> : "-"}</td>
                    <td>{account.pin ? <button className="table-copy" onClick={() => copy(account.pin || "")}>{account.pin}</button> : "-"}</td>
                    <td>{account.notes || "-"}</td>
                  </tr>
                ))}
                {filteredDeliveries.length === 0 && <tr><td colSpan={10}>Cuando el proveedor cargue las cuentas apareceran aqui.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        <section className="glass-panel">
          <SectionTitle eyebrow="Avisos" title="Notificaciones" compact />
          <div className="data-list">
            {notifications.length === 0 && <p className="empty">No tienes notificaciones pendientes.</p>}
            {notifications.map((notification) => (
              <article className="inline-product" key={notification.id}>
                <strong>{notification.title}</strong>
                <span>{notification.message}</span>
                <span>{formatDateTime(notification.created_at)}</span>
                {!notification.read && <button onClick={() => markNotificationRead(notification.id)}>Marcar leida</button>}
              </article>
            ))}
          </div>
        </section>
      </div>
      <AccountsModal order={accountsModalOrder} onClose={() => setAccountsModalOrder(null)} />
    </main>
  );
}

function ClientOrderTable({ orders, onOpenAccounts }: { orders: Order[]; onOpenAccounts: (order: Order) => void }) {
  return (
    <section className="glass-panel table-panel">
      <SectionTitle eyebrow="Pedidos" title="Historial" compact />
      <div className="table-scroll">
        <table>
          <thead><tr><th>Orden</th><th>Productos</th><th>Total</th><th>Estado</th><th>Fecha pedido</th><th>Fecha entrega</th><th>Cuentas</th></tr></thead>
          <tbody>
            {orders.map((order) => {
              const accountCount = order.items.reduce((sum, item) => sum + item.delivered_accounts.length, 0);
              return (
                <tr key={order.id}>
                  <td>{orderLabel(order)}</td>
                  <td>{order.items.map((item) => `${item.quantity}x ${item.product_name}`).join(", ")}</td>
                  <td>{money.format(order.total)}</td>
                  <td><SimpleOrderBadge delivered={accountCount > 0 || order.status === "delivered"} /></td>
                  <td>{formatDateTime(order.created_at)}</td>
                  <td>{formatDateTime(order.delivered_at)}</td>
                  <td>
                    {accountCount > 0 ? (
                      <button className="account-icon-button" onClick={() => onOpenAccounts(order)} title="Ver cuentas entregadas">
                        <span className="account-icon" aria-hidden="true" />
                        <strong>{accountCount}</strong>
                      </button>
                    ) : (
                      <span className="muted-cell">Pendiente</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AccountsModal({ order, onClose }: { order: Order | null; onClose: () => void }) {
  if (!order) return null;
  const deliveries = order.items.flatMap((item) => item.delivered_accounts.map((account) => ({ item, account })));
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <article className="accounts-modal">
        <div className="modal-headline">
          <div>
            <span className="eyebrow">Cuentas entregadas</span>
            <h2>{orderLabel(order)}</h2>
          </div>
          <button className="modal-close" onClick={onClose}>Cerrar</button>
        </div>
        <div className="accounts-modal-list">
          {deliveries.map(({ item, account }) => (
            <article className="account-access-card" key={account.id}>
              <div>
                <strong>{item.product_name}</strong>
                <span>Compra: {formatDateTime(order.created_at)} - Entrega: {formatDateTime(account.delivered_at)}</span>
              </div>
              <div className="account-access-grid">
                <div className="account-detail-field"><span>Usuario</span><strong>{account.delivered_email || "-"}</strong></div>
                <div className="account-detail-field"><span>Contrasena</span><strong>{account.delivered_password || "-"}</strong></div>
                <div className="account-detail-field"><span>Perfil</span><strong>{account.profile_name || "-"}</strong></div>
                <div className="account-detail-field"><span>PIN</span><strong>{account.pin || "-"}</strong></div>
              </div>
              {account.notes && <p>{account.notes}</p>}
            </article>
          ))}
        </div>
      </article>
    </div>
  );
}

function ProviderPanel({ orders, deliveries, deliver, busy }: {
  orders: Order[];
  deliveries: ProviderDelivery[];
  deliver: (orderId: string, item: OrderItem, event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
}) {
  const isPendingProviderOrder = (order: Order) => order.status !== "delivered" && order.status !== "cancelled";
  const activeOrders = orders.filter(isPendingProviderOrder);
  const pendingValue = activeOrders.reduce((sum, order) => sum + (order.provider_total || order.total), 0);
  const ordered = [...orders].sort((a, b) => {
    const weight: Record<OrderStatus, number> = { admin_payment_pending: 0, provider_delivery_pending: 1, wallet_pending: 2, payout_processing: 3, pending_payment: 4, paid: 5, pending: 6, processing: 7, delivered: 8, payout_failed: 9, payment_failed: 10, cancelled: 11 };
    return weight[a.status] - weight[b.status] || new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  return (
    <main className="page-shell panel-page">
      <div className="live-heading">
        <SectionTitle eyebrow="Panel proveedor" title="Pedidos pendientes y entregas" />
        <span className="nav-status"><span className="pulse-dot" /> Pedidos en vivo</span>
      </div>
      <div className="dashboard-grid">
        <Metric label="Pedidos pendientes" value={activeOrders.length} />
        <Metric label="Entregados hoy" value={deliveries.filter((delivery) => new Date(delivery.delivered_at).toDateString() === new Date().toDateString()).length} />
        <Metric label="Total entregados" value={deliveries.length} />
        <Metric label="Valor pendiente" value={money.format(pendingValue)} />
      </div>
      <section className="glass-panel">
        <SectionTitle eyebrow="Operacion" title="Pedidos pendientes" compact />
        <div className="data-list">
          {activeOrders.length === 0 && <p className="empty">No hay pedidos pendientes en este momento.</p>}
          {ordered.filter(isPendingProviderOrder).map((order) => (
            <OrderWorkCard key={order.id} order={order} deliver={deliver} busy={busy} />
          ))}
        </div>
      </section>
      <section className="glass-panel">
        <SectionTitle eyebrow="Historial" title="Pedidos entregados" compact />
        <div className="table-scroll">
          <table>
            <thead><tr><th>Fecha</th><th>Pedido</th><th>Producto</th><th>Cliente</th><th>Estado</th><th>Usuario</th><th>Perfil</th><th>Notas</th></tr></thead>
            <tbody>
              {deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <td>{formatDateTime(delivery.delivered_at)}</td>
                  <td>{delivery.order_number || `#${delivery.order_id.slice(0, 8)}`}</td>
                  <td>{delivery.product_name}</td>
                  <td>{delivery.client_name}</td>
                  <td><SimpleOrderBadge delivered /></td>
                  <td>{delivery.delivered_email || "-"}</td>
                  <td>{delivery.profile_name || "-"}</td>
                  <td>{delivery.notes || "-"}</td>
                </tr>
              ))}
              {deliveries.length === 0 && <tr><td colSpan={8}>Aun no hay entregas registradas.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function OrderWorkCard({ order, deliver, busy }: {
  order: Order;
  deliver: (orderId: string, item: OrderItem, event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
}) {
  const pendingItems = order.items.filter((item) => (item.delivered_accounts?.length || 0) < item.quantity);
  return (
    <article className="work-card">
      <div className="work-head">
        <strong>{orderLabel(order)}</strong>
        <SimpleOrderBadge delivered={false} />
      </div>
      <div className="order-meta">
        <span>Cliente: <strong>{order.user?.name || "Cliente"}</strong></span>
        <span>Fecha: <strong>{formatDateTime(order.created_at)}</strong></span>
        <span>Metodo pago: <strong>{order.providerPayouts?.[0]?.method || "Configurado por admin"}</strong></span>
        <span>Total proveedor: <strong>{money.format(order.provider_total || order.total)}</strong></span>
      </div>
      {pendingItems.map((item) => {
        const deliveredCount = item.delivered_accounts?.length || 0;
        const remaining = Math.max(item.quantity - deliveredCount, 0);
        return (
        <form className="delivery-form" key={item.id} onSubmit={(event) => deliver(order.id, item, event)}>
          <span>{remaining} pendiente(s) de {item.quantity} - {item.product_name} - Valor proveedor: {money.format(item.subtotal || 0)}</span>
          <input name="delivered_email" type="email" placeholder="Correo entregado" required />
          <input name="delivered_password" placeholder="Contrasena" required />
          <div className="mini-grid">
            <input name="profile_name" placeholder="Perfil" />
            <input name="pin" placeholder="PIN" />
          </div>
          <textarea name="notes" placeholder="Observaciones" />
          <button className="btn-solid" disabled={busy}>Cargar cuenta y entregar</button>
        </form>
        );
      })}
    </article>
  );
}

function AdminPanel({ dashboard, users, products, orders, pendingDeliveryOrders, pendingPayouts, providerConfig, whatsappStatus, whatsappQr, emailStatus, adminLogs, saveProduct, saveProviderConfig, saveAdminNotificationConfig, saveEmailConfig, testAdminEmail, connectWhatsApp, retryWhatsAppFailed, disconnectWhatsApp, testAdminWhatsApp, markReceiptSent, previewDeliveryMessage, approveParsedDelivery, saveDeliveryDraft, updateStatus, saveOrderEdit, copy }: {
  dashboard: Dashboard | null;
  users: User[];
  products: Product[];
  orders: Order[];
  pendingDeliveryOrders: Order[];
  pendingPayouts: ProviderPayout[];
  providerConfig: ProviderConfig | null;
  whatsappStatus: WhatsAppBridgeStatus | null;
  whatsappQr: string | null;
  emailStatus: EmailStatus | null;
  adminLogs: SystemLog[];
  saveProduct: (event: FormEvent<HTMLFormElement>, product?: Product) => void;
  saveProviderConfig: (event: FormEvent<HTMLFormElement>) => void;
  saveAdminNotificationConfig: (event: FormEvent<HTMLFormElement>) => void;
  saveEmailConfig: (event: FormEvent<HTMLFormElement>) => void;
  testAdminEmail: () => void;
  connectWhatsApp: () => void;
  retryWhatsAppFailed: () => void;
  disconnectWhatsApp: () => void;
  testAdminWhatsApp: () => void;
  markReceiptSent: (payout: ProviderPayout) => void;
  previewDeliveryMessage: (orderId: string | undefined, rawText: string) => Promise<{ preview: DeliveryParserPreview; order: Order }>;
  approveParsedDelivery: (orderId: string, rawText: string, items: DeliveryParserItem[]) => Promise<void>;
  saveDeliveryDraft: (orderId: string, rawText: string, preview: DeliveryParserPreview) => Promise<void>;
  updateStatus: (orderId: string, status: OrderStatus) => void;
  saveOrderEdit: (orderId: string, event: FormEvent<HTMLFormElement>) => void;
  copy: (text?: string | null) => void;
}) {
  const pendingOrders = pendingDeliveryOrders;
  const [parserOrderId, setParserOrderId] = useState("");
  const [parserRawText, setParserRawText] = useState("");
  const [parserPreview, setParserPreview] = useState<DeliveryParserPreview | null>(null);
  const selectedParserOrder = pendingOrders.find((order) => order.id === parserOrderId);
  const compatiblePreviewItems = parserPreview?.items.filter((item) => !item.incompatible && item.matchedOrderItemId && item.matchedProductId) || [];
  const incompatiblePreviewItems = parserPreview?.items.filter((item) => item.incompatible || !item.matchedOrderItemId || !item.matchedProductId) || [];

  async function interpretDeliveryMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!parserOrderId || !parserRawText.trim()) return;
    const { preview, order } = await previewDeliveryMessage(parserOrderId || undefined, parserRawText);
    setParserOrderId(order.id);
    setParserPreview(preview);
  }

  function updatePreviewItem(index: number, patch: Partial<DeliveryParserItem>) {
    setParserPreview((current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)
      };
    });
  }

  async function approvePreview() {
    if (!parserPreview || !parserOrderId) return;
    await approveParsedDelivery(parserOrderId, parserRawText, compatiblePreviewItems);
    setParserPreview(null);
    setParserRawText("");
  }

  async function savePreviewAsDraft() {
    if (!parserPreview || !parserOrderId) return;
    await saveDeliveryDraft(parserOrderId, parserRawText, parserPreview);
    setParserPreview(null);
    setParserRawText("");
  }

  type AdminModule = "dashboard" | "orders" | "process" | "payouts" | "products" | "servimil" | "provider" | "whatsapp" | "movements" | "logs";
  const [adminModule, setAdminModule] = useState<AdminModule>("dashboard");
  const adminModules: Array<{ id: AdminModule; label: string }> = [
    { id: "dashboard", label: "Dashboard" },
    { id: "orders", label: "Pedidos" },
    { id: "process", label: "Procesar cuentas" },
    { id: "payouts", label: "Pagos al proveedor" },
    { id: "products", label: "Productos" },
    { id: "servimil", label: "Servimil" },
    { id: "provider", label: "Proveedor" },
    { id: "whatsapp", label: "WhatsApp admin" },
    { id: "movements", label: "Movimientos" },
    { id: "logs", label: "Logs" }
  ];
  const servimilUser = users.find((user) => user.name.toLowerCase().includes("servimil") || user.email === "cliente@centrodigital.local");
  const servimilOrders = orders.filter((order) => !servimilUser || order.user_id === servimilUser.id || order.user?.name?.toLowerCase().includes("servimil"));
  const servimilDeliveredAccounts = servimilOrders.flatMap((order) => order.items.flatMap((item) => item.delivered_accounts || []));
  const providerPayoutHistory = dashboard?.providerPayouts || [];
  const bridgeConnectedNumber = normalizePhoneForCompare(whatsappStatus?.connectedNumber);
  const adminNotificationNumber = normalizePhoneForCompare(providerConfig?.admin_notification_phone);
  const adminUsesBridgeNumber = Boolean(bridgeConnectedNumber && adminNotificationNumber && bridgeConnectedNumber === adminNotificationNumber);

  const processAccountsModule = (
    <section className="glass-panel payments-panel admin-module-panel">
      <SectionTitle eyebrow="Entrega manual" title="Procesar cuentas entregadas" compact />
      <form className="product-form parser-form" onSubmit={interpretDeliveryMessage}>
        <SectionTitle eyebrow="Ordenes Servimil" title="Selecciona una orden pendiente" compact />
        <div className="order-picker-list">
          {pendingOrders.length === 0 && <p className="empty">No hay ordenes pendientes de Servimil.</p>}
          {pendingOrders.map((order) => (
            <button
              className={parserOrderId === order.id ? "order-picker-card active" : "order-picker-card"}
              key={order.id}
              type="button"
              onClick={() => { setParserOrderId(order.id); setParserPreview(null); }}
            >
              <strong>{orderLabel(order)}</strong>
              <span>Cliente: Servimil</span>
              <span>{formatDateTime(order.created_at)} - Estado: Pendiente</span>
              <span>{order.items.map((item) => `${item.quantity}x ${item.product_name}`).join(", ")}</span>
              <em>Seleccionar orden</em>
            </button>
          ))}
        </div>
        {selectedParserOrder && (
          <div className="order-detail-box">
            <strong>{orderLabel(selectedParserOrder)} - Servimil</strong>
            <span>Fecha: {formatDateTime(selectedParserOrder.created_at)} - Estado: Pendiente</span>
            <div className="order-detail-items">
              {selectedParserOrder.items.map((item) => (
                <span key={item.id}>
                  {item.product_name}: {item.quantity} solicitada(s), {item.delivered_accounts?.length || item.delivered_quantity || 0} entregada(s), {item.pending_quantity ?? Math.max(item.quantity - (item.delivered_accounts?.length || 0), 0)} pendiente(s)
                </span>
              ))}
            </div>
          </div>
        )}
        <textarea
          className="large-textarea"
          value={parserRawText}
          onChange={(event) => { setParserRawText(event.target.value); setParserPreview(null); }}
          placeholder="Pega aqui el mensaje completo del proveedor con las cuentas entregadas..."
          disabled={!selectedParserOrder}
          required
        />
        <button className="btn-solid" disabled={!selectedParserOrder || !parserRawText.trim()}>Interpretar mensaje</button>
      </form>
      {parserPreview && (
        <div className="preview-panel">
          <div className="hint">Vista previa para {selectedParserOrder ? orderLabel(selectedParserOrder) : "orden detectada"} - Confianza general: {parserPreview.confidence}%</div>
          {parserPreview.warnings.length > 0 && (
            <div className="warning-list">
              {parserPreview.warnings.map((warning) => <span key={warning}>{warning}</span>)}
            </div>
          )}
          <SectionTitle eyebrow="Vista previa" title="Cuentas compatibles detectadas" compact />
          <div className="data-list">
            {compatiblePreviewItems.length === 0 && <p className="empty">No hay cuentas compatibles con la orden seleccionada.</p>}
            {compatiblePreviewItems.map((item, index) => {
              const originalIndex = parserPreview.items.indexOf(item);
              return (
                <article className="inline-product" key={`${item.serviceName}-${index}`}>
                  <strong>{item.serviceName} - {item.needsReview ? "Requiere revision" : "Listo"} - {item.confidence}%</strong>
                  <select value={item.matchedOrderItemId || ""} onChange={(event) => {
                    const orderItem = selectedParserOrder?.items.find((orderItem) => orderItem.id === event.target.value);
                    updatePreviewItem(originalIndex, { matchedOrderItemId: orderItem?.id, matchedProductId: orderItem?.product_id, needsReview: false, incompatible: false, incompatibleReason: undefined });
                  }}>
                    <option value="">Producto relacionado</option>
                    {selectedParserOrder?.items.map((orderItem) => (
                      <option key={orderItem.id} value={orderItem.id}>{orderItem.quantity}x {orderItem.product_name}</option>
                    ))}
                  </select>
                  <div className="mini-grid">
                    <input value={item.delivered_email || item.delivered_user || ""} onChange={(event) => updatePreviewItem(originalIndex, { delivered_email: event.target.value })} placeholder="Correo / usuario" />
                    <input value={item.delivered_password || ""} onChange={(event) => updatePreviewItem(originalIndex, { delivered_password: event.target.value })} placeholder="Contrasena" />
                  </div>
                  <div className="mini-grid">
                    <input value={item.profile_name || ""} onChange={(event) => updatePreviewItem(originalIndex, { profile_name: event.target.value })} placeholder="Perfil" />
                    <input value={item.pin || ""} onChange={(event) => updatePreviewItem(originalIndex, { pin: event.target.value })} placeholder="PIN" />
                  </div>
                  <input value={item.iptv_url || ""} onChange={(event) => updatePreviewItem(originalIndex, { iptv_url: event.target.value })} placeholder="URL IPTV" />
                  <textarea value={item.notes || ""} onChange={(event) => updatePreviewItem(originalIndex, { notes: event.target.value })} placeholder="Notas" />
                </article>
              );
            })}
          </div>
          <SectionTitle eyebrow="Advertencias" title="Cuentas no compatibles" compact />
          <div className="data-list">
            {incompatiblePreviewItems.length === 0 && <p className="empty">No se detectaron cuentas fuera de esta orden.</p>}
            {incompatiblePreviewItems.map((item, index) => (
              <article className="inline-product incompatible-product" key={`${item.serviceName}-incompatible-${index}`}>
                <strong>{item.serviceName} - No compatible</strong>
                <span>{item.incompatibleReason || "Este servicio no pertenece a la orden seleccionada."}</span>
                <span>Confianza: {item.confidence}%</span>
                {(item.delivered_email || item.delivered_user) && <span>Usuario detectado: {item.delivered_email || item.delivered_user}</span>}
              </article>
            ))}
          </div>
          <div className="status-actions">
            <button onClick={approvePreview} disabled={compatiblePreviewItems.length === 0}>Aprobar y entregar al cliente</button>
            <button onClick={savePreviewAsDraft}>Guardar borrador</button>
            <button onClick={() => setParserPreview(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </section>
  );

  return (
    <main className="page-shell panel-page">
      <div className="live-heading">
        <SectionTitle eyebrow="Dashboard admin" title="Movimientos, ventas y actividad" />
        <span className="nav-status"><span className="pulse-dot" /> Actualizando dashboard</span>
      </div>
      <nav className="admin-tabs" aria-label="Modulos admin">
        {adminModules.map((module) => (
          <button
            className={`${adminModule === module.id ? "active" : ""} ${module.id === "process" ? "primary-module" : ""}`.trim()}
            key={module.id}
            onClick={() => setAdminModule(module.id)}
            type="button"
          >
            {module.label}
          </button>
        ))}
      </nav>
      <select className="admin-module-select" value={adminModule} onChange={(event) => setAdminModule(event.target.value as AdminModule)}>
        {adminModules.map((module) => <option key={module.id} value={module.id}>{module.label}</option>)}
      </select>
      {adminModule === "dashboard" && (
        <div className="admin-module-stack">
          <div className="dashboard-grid">
            <Metric label="Total vendido" value={money.format(dashboard?.totalSold || 0)} />
            <Metric label="Total proveedor" value={money.format(dashboard?.totalProviderPaid || 0)} />
            <Metric label="Utilidad" value={money.format(dashboard?.totalProfit || 0)} />
            <Metric label="Pedidos pendientes" value={dashboard?.pendingOrders || 0} />
            <Metric label="Pedidos entregados" value={dashboard?.deliveredOrders || 0} />
            <Metric label="Cuentas procesadas" value={dashboard?.deliveredAccounts || 0} />
            <Metric label="WhatsApp pendientes" value={dashboard?.notificationPending || 0} />
            <Metric label="WhatsApp fallidos" value={dashboard?.notificationFailed || 0} />
          </div>
          <section className="glass-panel">
            <SectionTitle eyebrow="Actividad" title="Ultimos movimientos" compact />
            <div className="data-list">
              {(dashboard?.movements || []).slice(0, 5).map((movement) => (
                <div key={movement.id}>
                  <strong>{movement.type}</strong>
                  <span>{movement.description}</span>
                  <span>Orden: {orderLabel(movement.order)} - {formatDateTime(movement.created_at)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
      <div className="admin-module-content">
        {adminModule === "orders" && <OrderTable orders={orders} updateStatus={updateStatus} saveOrderEdit={saveOrderEdit} title="Pedidos" />}
        {adminModule === "process" && processAccountsModule}
        {adminModule === "payouts" && (
          <section className="glass-panel payments-panel admin-module-panel">
            <SectionTitle eyebrow="Pagos manuales" title="Pagos al proveedor" compact />
            <div className="data-list">
              {pendingPayouts.length === 0 && <p className="empty">No hay pagos pendientes al proveedor.</p>}
              {pendingPayouts.map((payout) => (
                <article className="inline-product" key={payout.id}>
                  <strong>{payout.order?.order_number || `#${payout.order_id.slice(0, 8)}`} - Servimil</strong>
                  <span>{payout.order?.items?.map((item) => `${item.quantity}x ${item.product_name}`).join(", ")}</span>
                  <span>Valor proveedor: {money.format(payout.amount)} - Metodo: {payout.destination_type || payout.method}</span>
                  <span>Numero destino: {payout.destination_phone || "-"}</span>
                  <div className="status-actions">
                    <button onClick={() => copy(payout.destination_phone)}>Copiar numero</button>
                    <button onClick={() => copy(String(payout.amount))}>Copiar valor</button>
                    <button onClick={() => copy(`Orden ${payout.order?.order_number || payout.order_id} - pagar ${money.format(payout.amount)} a ${payout.destination_type || payout.method}: ${payout.destination_phone}`)}>Copiar resumen</button>
                    <button onClick={() => markReceiptSent(payout)}>Marcar pago/comprobante gestionado</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        {adminModule === "products" && (
          <section className="glass-panel products-admin admin-module-panel">
            <SectionTitle eyebrow="Catalogo" title="Productos" compact />
            <form className="product-form" onSubmit={(event) => saveProduct(event)}>
              <input name="name" placeholder="Nombre" required />
              <input name="description" placeholder="Descripcion" required />
              <input name="category" placeholder="Categoria" required />
              <input name="brand_key" placeholder="Marca visual" required />
              <input name="price" type="number" placeholder="Precio venta" required />
              <input name="provider_cost" type="number" placeholder="Precio proveedor" />
              <input name="duration" placeholder="Duracion" />
              <input name="screens" placeholder="Pantallas / perfiles" />
              <input name="content_type" placeholder="Tipo de contenido" />
              <textarea name="benefits" placeholder="Beneficios, uno por linea" />
              <label><input name="active" type="checkbox" defaultChecked /> Activo</label>
              <button className="btn-solid">Crear producto</button>
            </form>
            <div className="data-list">
              {products.map((product) => (
                <form key={product.id} className="inline-product" onSubmit={(event) => saveProduct(event, product)}>
                  <strong>{product.name} - Utilidad: {money.format(product.price - (product.provider_cost || 0))}</strong>
                  <input name="name" defaultValue={product.name} />
                  <input name="description" defaultValue={product.description} />
                  <input name="category" defaultValue={product.category} />
                  <input name="brand_key" defaultValue={product.brand_key} />
                  <input name="price" type="number" defaultValue={product.price} />
                  <input name="provider_cost" type="number" defaultValue={product.provider_cost || 0} />
                  <input name="duration" defaultValue={product.duration || ""} />
                  <input name="screens" defaultValue={product.screens || ""} />
                  <input name="content_type" defaultValue={product.content_type || ""} />
                  <textarea name="benefits" defaultValue={(product.benefits || []).join("\n")} />
                  <label><input name="active" type="checkbox" defaultChecked={product.active} /> Activo</label>
                  <button>Guardar</button>
                </form>
              ))}
            </div>
          </section>
        )}
        {adminModule === "servimil" && (
          <div className="admin-module-stack">
            <section className="glass-panel">
              <SectionTitle eyebrow="Cliente principal" title="Servimil" compact />
              <div className="dashboard-grid mini-metrics">
                <Metric label="Nombre" value={servimilUser?.name || "Servimil"} />
                <Metric label="Codigo acceso" value="1111" />
                <Metric label="Total vendido" value={money.format(servimilOrders.reduce((sum, order) => sum + (order.sale_total || order.total || 0), 0))} />
                <Metric label="Cuentas entregadas" value={servimilDeliveredAccounts.length} />
              </div>
            </section>
            <OrderTable orders={servimilOrders} title="Historial de pedidos Servimil" />
            <section className="glass-panel">
              <SectionTitle eyebrow="Liquidacion" title="Historial mensual" compact />
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Mes</th><th>Total vendido</th><th>Pagado proveedor</th><th>Utilidad</th><th>Pedidos</th><th>Estado</th></tr></thead>
                  <tbody>{(dashboard?.monthlyStatements || []).map((statement) => (
                    <tr key={`${statement.month}-${statement.client.id}`}><td>{statement.month}</td><td>{money.format(statement.totalSold)}</td><td>{money.format(statement.totalProviderPaid)}</td><td>{money.format(statement.profit)}</td><td>{statement.orders}</td><td>{statement.status}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          </div>
        )}
        {adminModule === "provider" && (
          <div className="admin-module-stack">
            <section className="glass-panel provider-config-panel">
              <SectionTitle eyebrow="Configuracion privada" title="Proveedor" compact />
              <form className="product-form" onSubmit={saveProviderConfig}>
                <input name="provider_name" placeholder="Nombre del proveedor" defaultValue={providerConfig?.provider_name || ""} required />
                <input name="provider_whatsapp_number" placeholder="Telefono WhatsApp proveedor" defaultValue={providerConfig?.provider_whatsapp_number || ""} />
                <input type="hidden" name="admin_notification_phone" value={providerConfig?.admin_notification_phone || ""} />
                <input type="hidden" name="admin_notification_email" value={providerConfig?.admin_notification_email || ""} />
                <input type="hidden" name="provider_notification_method" value={providerConfig?.provider_notification_method || "bridge"} />
                <input type="hidden" name="provider_notifications_active" value="on" />
                <select name="provider_payment_method" defaultValue={providerConfig?.provider_payment_method || "nequi"}>
                  <option value="nequi">Nequi</option>
                  <option value="daviplata">DaviPlata</option>
                  <option value="bancolombia">Bancolombia</option>
                </select>
                <input name="provider_payment_phone" placeholder="Numero destino" defaultValue={providerConfig?.provider_payment_phone || ""} required />
                <input name="provider_document" placeholder="Documento del proveedor" defaultValue={providerConfig?.provider_document || ""} />
                <label><input name="provider_payment_active" type="checkbox" defaultChecked={providerConfig?.provider_payment_active ?? true} /> Proveedor activo</label>
                <button className="btn-solid">Guardar proveedor</button>
              </form>
            </section>
            <section className="glass-panel payments-panel">
              <SectionTitle eyebrow="Historial" title="Pagos al proveedor" compact />
              <div className="dashboard-grid mini-metrics">
                <Metric label="Total pagado" value={money.format(dashboard?.totalProviderPaid || 0)} />
                <Metric label="Fallidos" value={providerConfig?.failed_payouts || 0} />
              </div>
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Pedido</th><th>Monto</th><th>Estado</th><th>Metodo</th><th>Destino</th><th>Referencia</th><th>Fecha</th></tr></thead>
                  <tbody>{providerPayoutHistory.map((payout) => (
                    <tr key={payout.id}><td>{payout.order?.order_number || `#${payout.order_id.slice(0, 8)}`}</td><td>{money.format(payout.amount)}</td><td>{payout.status}</td><td>{payout.method}</td><td>{payout.destination_type || "-"}</td><td>{payout.reference || payout.transaction_id || "-"}</td><td>{formatDateTime(payout.confirmed_at || payout.created_at)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          </div>
        )}
        {adminModule === "whatsapp" && (
          <section className="glass-panel provider-config-panel admin-module-panel">
            <SectionTitle eyebrow="Canales automaticos" title="WhatsApp y correo del admin" compact />
            <form className="product-form compact-form" onSubmit={saveAdminNotificationConfig}>
              <input name="admin_notification_phone" placeholder="Numero WhatsApp del admin" defaultValue={providerConfig?.admin_notification_phone || ""} />
              <input name="admin_notification_email" placeholder="Correo respaldo del admin" defaultValue={providerConfig?.admin_notification_email || ""} />
              <button className="btn-solid">Guardar destinos de avisos</button>
            </form>

            <div className="notification-channel">
              <h3>WhatsApp Bridge Baileys</h3>
              <div className="dashboard-grid mini-metrics">
                <Metric label="Bridge" value={whatsappStatus?.enabled ? "Activo" : "Inactivo"} />
                <Metric label="Sesion" value={whatsappStatus?.connection || "-"} />
                <Metric label="Numero vinculado" value={whatsappStatus?.connectedNumber || "-"} />
                <Metric label="Numero avisos" value={providerConfig?.admin_notification_phone || "-"} />
                <Metric label="Pendientes" value={whatsappStatus?.pending || 0} />
                <Metric label="Enviados" value={whatsappStatus?.sent || 0} />
                <Metric label="Fallidos" value={whatsappStatus?.failed || 0} />
                <Metric label="Respaldo correo" value={whatsappStatus?.emailFallback || 0} />
              </div>
              {adminUsesBridgeNumber && (
                <div className="warning-list">
                  <span>El numero vinculado y el numero de avisos son el mismo; WhatsApp normalmente no muestra notificacion push en chats contigo mismo.</span>
                  <span>Usa otro numero como destino o conserva el correo de respaldo activo.</span>
                </div>
              )}
              {whatsappQr ? (
                <div className="qr-panel">
                  <img src={whatsappQr} alt="QR de WhatsApp Bridge" />
                  <p className="hint">Escanea el QR desde WhatsApp, Dispositivos vinculados. La sesion se guarda cifrada en la base de datos.</p>
                </div>
              ) : (
                <p className="hint">{whatsappStatus?.qrPending ? "QR Baileys listo para escanear." : "Inicia la vinculacion para generar un QR o restaurar la sesion cifrada."}</p>
              )}
              {whatsappStatus?.lastError && <p className="error-text">{whatsappStatus.lastError}</p>}
              <div className="status-actions">
                {whatsappStatus?.connection !== "connected" && <button className="btn-solid" onClick={connectWhatsApp}>Iniciar vinculacion</button>}
                <button onClick={retryWhatsAppFailed}>Reintentar fallidos</button>
                <button onClick={disconnectWhatsApp}>Desconectar sesion</button>
                <button onClick={testAdminWhatsApp} disabled={whatsappStatus?.connection !== "connected"}>Enviar prueba WhatsApp</button>
              </div>
            </div>

            <div className="notification-channel">
              <h3>Correo de respaldo</h3>
              <form className="product-form smtp-form" onSubmit={saveEmailConfig}>
                <input name="smtp_host" placeholder="Servidor SMTP" defaultValue={emailStatus?.host || "smtp.gmail.com"} required />
                <input name="smtp_port" type="number" min="1" max="65535" placeholder="Puerto" defaultValue={emailStatus?.port || 465} required />
                <select name="smtp_secure" defaultValue={String(emailStatus?.configured ? emailStatus.secure : true)}>
                  <option value="true">Conexion segura SSL (465)</option>
                  <option value="false">STARTTLS (587)</option>
                </select>
                <input name="smtp_user" type="email" placeholder="Usuario SMTP" defaultValue={emailStatus?.user || providerConfig?.admin_notification_email || ""} />
                <input name="smtp_password" type="password" autoComplete="new-password" placeholder={emailStatus?.passwordConfigured ? "Contrasena guardada; deja vacio para conservar" : "Contrasena de aplicacion"} />
                <input name="smtp_from" placeholder="Remitente" defaultValue={emailStatus?.from || providerConfig?.admin_notification_email || ""} required />
                <button className="btn-solid">Guardar configuracion SMTP</button>
              </form>
              <div className="dashboard-grid mini-metrics email-metrics">
                <Metric label="Configuracion" value={emailStatus?.configured ? "Lista" : "Pendiente"} />
                <Metric label="Credencial" value={emailStatus?.passwordConfigured ? "Guardada" : "Falta"} />
                <Metric label="Destino" value={emailStatus?.recipient || "-"} />
                <Metric label="Ultima prueba" value={emailStatus?.lastTestStatus || "Sin probar"} />
              </div>
              {emailStatus?.lastTestAt && <p className="hint">Ultima comprobacion: {formatDateTime(emailStatus.lastTestAt)}</p>}
              {emailStatus?.lastError && <p className="error-text">{emailStatus.lastError}</p>}
              <div className="status-actions">
                <button className="btn-solid" onClick={testAdminEmail} disabled={!emailStatus?.configured}>Enviar correo de prueba</button>
              </div>
            </div>
          </section>
        )}
        {adminModule === "movements" && (
          <section className="glass-panel admin-module-panel">
            <SectionTitle eyebrow="Auditoria" title="Movimientos" compact />
            <div className="data-list">
              {(dashboard?.movements || []).map((movement) => (
                <div key={movement.id}>
                  <strong>{movement.type}</strong>
                  <span>{movement.description}</span>
                  <span>Usuario: {movement.user?.email || "-"} - Orden: {orderLabel(movement.order)} - {formatDateTime(movement.created_at)}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        {adminModule === "logs" && (
          <section className="glass-panel admin-module-panel">
            <SectionTitle eyebrow="Sistema" title="Logs" compact />
            <div className="table-scroll">
              <table>
                <thead><tr><th>Fecha</th><th>Fuente</th><th>Tipo</th><th>Estado</th><th>Orden</th><th>Detalle</th><th>Intentos</th></tr></thead>
                <tbody>{adminLogs.map((log) => (
                  <tr key={log.id}>
                    <td>{formatDateTime(log.created_at)}</td>
                    <td>{log.source}</td>
                    <td>{log.type}</td>
                    <td>{log.status || "-"}</td>
                    <td>{log.order_label || "-"}</td>
                    <td>{log.description}{log.last_error ? ` - Error: ${log.last_error}` : ""}</td>
                    <td>{log.attempts ?? "-"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function OrderTable({ orders, updateStatus, saveOrderEdit, title = "Historial" }: { orders: Order[]; updateStatus?: (orderId: string, status: OrderStatus) => void; saveOrderEdit?: (orderId: string, event: FormEvent<HTMLFormElement>) => void; title?: string }) {
  return (
    <section className="glass-panel table-panel">
      <SectionTitle eyebrow="Pedidos" title={title} compact />
      <div className="table-scroll">
        <table>
          <thead><tr><th>Orden</th><th>Cliente</th><th>Productos</th><th>Total venta</th><th>Total proveedor</th><th>Utilidad</th><th>Estado</th><th>Fecha</th><th>Detalle</th></tr></thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>{orderLabel(order)}</td>
                <td>{order.user?.name || "Servimil"}</td>
                <td>{order.items.map((item) => `${item.quantity}x ${item.product_name}`).join(", ")}</td>
                <td>{money.format(order.sale_total || order.total)}</td>
                <td>{money.format(order.provider_total || 0)}</td>
                <td>{money.format(order.profit_total || 0)}</td>
                <td><StatusBadge status={order.status} /></td>
                <td>{formatDateTime(order.created_at)}</td>
                <td>
                  <details className="order-detail-popover">
                    <summary>Ver detalle</summary>
                    <div className="timeline-cell">
                      <span>Pedido creado: {formatDateTime(order.created_at)}</span>
                      <span>Admin notificado: {formatDateTime(order.admin_notified_at)} ({order.admin_notification_channel || "pendiente"})</span>
                      <span>Pago gestionado: {formatDateTime(order.provider_payment_marked_at)}</span>
                      <span>Cuenta procesada: {formatDateTime(order.delivery_processed_at)}</span>
                      <span>Cliente notificado: {formatDateTime(order.client_notified_at)}</span>
                      <span>Entregado: {formatDateTime(order.delivered_at)}</span>
                      <span>Proveedor: {order.provider?.name || "-"}</span>
                    </div>
                    {updateStatus && (
                      <select value={order.status} onChange={(event) => updateStatus(order.id, event.target.value as OrderStatus)}>
                        <option value="admin_payment_pending">Pago admin pendiente</option>
                        <option value="provider_delivery_pending">Pendiente proveedor</option>
                        <option value="processing">En proceso</option>
                        <option value="delivered">Entregado</option>
                        <option value="cancelled">Cancelado</option>
                      </select>
                    )}
                    {saveOrderEdit && (
                      <form className="order-edit-form" onSubmit={(event) => saveOrderEdit(order.id, event)}>
                        <select name="status" defaultValue={order.status}>
                          <option value="admin_payment_pending">Pago admin pendiente</option>
                          <option value="provider_delivery_pending">Pendiente proveedor</option>
                          <option value="processing">En proceso</option>
                          <option value="delivered">Entregado</option>
                          <option value="cancelled">Cancelado</option>
                        </select>
                        <input name="sale_total" type="number" defaultValue={order.sale_total || order.total || 0} placeholder="Total venta" />
                        <input name="provider_total" type="number" defaultValue={order.provider_total || 0} placeholder="Total proveedor" />
                        <input name="profit_total" type="number" defaultValue={order.profit_total || 0} placeholder="Utilidad" />
                        <select name="payout_status" defaultValue={order.payout_status || "pending_admin_payment"}>
                          <option value="pending_admin_payment">Pago admin pendiente</option>
                          <option value="receipt_sent_to_provider">Comprobante gestionado</option>
                          <option value="cancelled">Cancelado</option>
                          <option value="failed">Fallido</option>
                        </select>
                        <button>Guardar cambios</button>
                      </form>
                    )}
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SectionTitle({ eyebrow, title, compact = false }: { eyebrow: string; title: string; compact?: boolean }) {
  return <div className={compact ? "panel-title compact" : "panel-title"}><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong></article>;
}

function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`status-badge ${status}`}>{statusLabels[status]}</span>;
}

function SimpleOrderBadge({ delivered }: { delivered: boolean }) {
  return <span className={`status-badge ${delivered ? "delivered" : "pending"}`}>{delivered ? "Entregado" : "Pendiente"}</span>;
}

function StatusRole({ role }: { role: Role }) {
  return <span className="role-badge">{role}</span>;
}

export default App;
