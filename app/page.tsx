"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

type EventItem = {
  id: string;
  name: string;
  type: string;
  date: string;
  guests: number;
  budget: number;
};

type BudgetItem = {
  id: string;
  eventId: string;
  category: string;
  amount: number;
};

type ChecklistItem = {
  id: string;
  eventId: string;
  title: string;
  category: string;
  completed: boolean;
  createdAt?: string;
};

type OllamaStatus = {
  status: "online" | "offline" | "unknown";
  model: string;
  modelAvailable?: boolean;
  message: string;
};

type CopilotMessage = { id?: string; role: "user" | "assistant"; content: string; createdAt?: string };

type Plan = {
  summary: string;
  budgetBreakdown: { category: string; amount: number; percent: number }[];
  timeline: { time: string; task: string; priority?: string; date?: string }[];
  checklist: string[];
  ideas?: string[];
  notes?: string[];
  theme?: string;
  colorPalette?: string[];
  decoration?: string[];
  food?: string[];
  entertainment?: string[];
  savingsTips?: string[];
};

const navItems = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "events", label: "My Events", icon: "▦" },
  { id: "budget", label: "Budget Planner", icon: "₹" },
  { id: "timeline", label: "Timeline & Tasks", icon: "◷" },
  { id: "vendors", label: "Vendor Checklist", icon: "✓" },
  { id: "copilot", label: "AI Co-Pilot", icon: "✦" },
];

const currency = (amount: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);

export default function HomePage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [authUser, setAuthUser] = useState<{ id: string; email: string } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState("");
  const [activeSection, setActiveSection] = useState("overview");
  const [dark, setDark] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventName, setEventName] = useState("");
  const [eventType, setEventType] = useState("Wedding");
  const [eventDate, setEventDate] = useState("");
  const [guests, setGuests] = useState("100");
  const [budget, setBudget] = useState("50000");
  const [notice, setNotice] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [chatMessages, setChatMessages] = useState<CopilotMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatHistoryLoading, setChatHistoryLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [clearingChat, setClearingChat] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState("");
  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>([]);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetCategory, setBudgetCategory] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [checklistTitle, setChecklistTitle] = useState("");
  const [checklistCategory, setChecklistCategory] = useState("General");
  const [savingItem, setSavingItem] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>({
    status: "unknown",
    model: "qwen2.5:1.5b",
    message: "Checking local Ollama status…",
  });

  useEffect(() => {
    let cancelled = false;
    async function loadEvents() {
      setEventsLoading(true);
      setEventsError("");
      try {
        const response = await fetch("/api/events", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.success || !Array.isArray(result.events)) {
          throw new Error(result.error ?? "Could not load events from the database.");
        }
        if (!cancelled) {
          const loaded = result.events as EventItem[];
          setEvents(loaded);
          setSelectedEventId((current) => loaded.some((event) => event.id === current) ? current : (loaded[0]?.id ?? ""));
        }
      } catch (error) {
        if (!cancelled) setEventsError(error instanceof Error ? error.message : "Could not load events from the database.");
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    }
    async function verifySession() {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result?.user) return;
        if (!cancelled) {
          setAuthUser(result.user);
          await loadEvents();
        }
      } catch {
        if (!cancelled) setAuthError("Could not verify your session. Please refresh the page.");
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    }
    void verifySession();
    // Read the browser preference after mount without synchronously updating
    // React state in the effect body (required by the React Hooks lint rule).
    const themeFrame = window.requestAnimationFrame(() => {
      try {
        const savedTheme = localStorage.getItem("eventpilot-theme");
        if (savedTheme) setDark(savedTheme === "dark");
      } catch {
        // Theme and checklist preferences are optional browser-side settings.
      }
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(themeFrame);
    };
  }, []);
  useEffect(() => {
    try { localStorage.setItem("eventpilot-theme", dark ? "dark" : "light"); } catch {}
  }, [dark]);
  useEffect(() => {
    let cancelled = false;

    async function checkOllamaStatus() {
      try {
        const response = await fetch("/api/ollama-status", { cache: "no-store" });
        const result = await response.json();
        if (cancelled) return;

        if (!response.ok || !result || !["online", "offline"].includes(result.status)) {
          setOllamaStatus({
            status: "offline",
            model: typeof result?.model === "string" ? result.model : "qwen2.5:1.5b",
            message: typeof result?.message === "string" ? result.message : "Could not verify Ollama status.",
          });
          return;
        }

        setOllamaStatus({
          status: result.status,
          model: typeof result.model === "string" ? result.model : "qwen2.5:1.5b",
          modelAvailable: Boolean(result.modelAvailable),
          message: typeof result.message === "string" ? result.message : "Ollama status checked.",
        });
      } catch {
        if (!cancelled) {
          setOllamaStatus({
            status: "offline",
            model: "qwen2.5:1.5b",
            message: "Could not reach the Ollama status API. Restart the Next.js dev server and check /api/ollama-status.",
          });
        }
      }
    }

    void checkOllamaStatus();
    const intervalId = window.setInterval(() => void checkOllamaStatus(), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);
  useEffect(() => {
    if (!selectedEventId) {
      // Defer clearing dependent state until after this effect has returned.
      const clearTimer = window.setTimeout(() => {
        setBudgetItems([]);
        setChecklistItems([]);
        setBudgetLoading(false);
        setChecklistLoading(false);
      }, 0);
      return () => window.clearTimeout(clearTimer);
    }

    let cancelled = false;
    async function loadEventDetails() {
      setBudgetLoading(true);
      setChecklistLoading(true);
      try {
        const [budgetResponse, checklistResponse] = await Promise.all([
          fetch(`/api/events/${encodeURIComponent(selectedEventId)}/budget`, { cache: "no-store" }),
          fetch(`/api/events/${encodeURIComponent(selectedEventId)}/checklist`, { cache: "no-store" }),
        ]);
        const [budgetResult, checklistResult] = await Promise.all([
          budgetResponse.json(),
          checklistResponse.json(),
        ]);
        if (!budgetResponse.ok) throw new Error(budgetResult.error ?? "Could not load budget items.");
        if (!checklistResponse.ok) throw new Error(checklistResult.error ?? "Could not load checklist items.");
        if (!cancelled) {
          setBudgetItems(Array.isArray(budgetResult.items) ? budgetResult.items : []);
          setChecklistItems(Array.isArray(checklistResult.items) ? checklistResult.items : []);
        }
      } catch (error) {
        if (!cancelled) setNotice(error instanceof Error ? error.message : "Could not load event details.");
      } finally {
        if (!cancelled) {
          setBudgetLoading(false);
          setChecklistLoading(false);
        }
      }
    }
    void loadEventDetails();
    return () => { cancelled = true; };
  }, [selectedEventId]);

  // Load the selected event's persistent Co-Pilot conversation history.
  // Load the selected event's persistent Co-Pilot conversation history.
useEffect(() => {
 if (!selectedEventId) {
    return;
  }
    let cancelled = false;
    async function loadChatHistory() {
      setChatHistoryLoading(true);
      setChatError("");
      try {
        const response = await fetch(`/api/copilot?eventId=${encodeURIComponent(selectedEventId)}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result?.success) throw new Error(result?.error ?? "Could not load chat history.");
        if (!cancelled) setChatMessages(Array.isArray(result.messages) ? result.messages.filter((m: CopilotMessage) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") : []);
      } catch (error) {
        if (!cancelled) setChatError(error instanceof Error ? error.message : "Could not load chat history.");
      } finally {
        if (!cancelled) setChatHistoryLoading(false);
      }
    }
    void loadChatHistory();
    return () => { cancelled = true; };
  }, [selectedEventId]);

  async function sendCopilotMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = chatInput.trim();
    if (!selectedEventId || !message || chatLoading) return;
    setChatError("");
    setChatLoading(true);
    setChatMessages((current) => [...current, { role: "user", content: message }]);
    setChatInput("");
    try {
      const response = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: selectedEventId, message }),
      });
      const result = await response.json();
      if (!response.ok || !result?.success || typeof result.reply !== "string") throw new Error(result?.error ?? "The AI could not reply.");
      setChatMessages((current) => [...current, { role: "assistant", content: result.reply }]);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Could not send your message.");
    } finally {
      setChatLoading(false);
    }
  }

  async function clearCopilotChat() {
    if (!selectedEventId || clearingChat || chatLoading) return;
    if (!window.confirm("Clear the saved chat history for this event?")) return;
    setClearingChat(true);
    setChatError("");
    try {
      const response = await fetch(`/api/copilot?eventId=${encodeURIComponent(selectedEventId)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok || !result?.success) throw new Error(result?.error ?? "Could not clear chat history.");
      setChatMessages([]);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Could not clear chat history.");
    } finally {
      setClearingChat(false);
    }
  }

  // Load the selected event's saved AI plan from SQLite.
  useEffect(() => {
    if (!selectedEventId) {
      const clearTimer = window.setTimeout(() => setPlan(null), 0);
      return () => window.clearTimeout(clearTimer);
    }

    let cancelled = false;
    async function loadSavedPlan() {
      try {
        const response = await fetch(
          `/api/plan?eventId=${encodeURIComponent(selectedEventId)}`,
          { cache: "no-store" },
        );
        const result = await response.json();
        if (!response.ok || !result?.success) {
          throw new Error(result?.error ?? "Could not load the saved plan.");
        }
        if (!cancelled) {
          setPlan(result.plan && typeof result.plan === "object"
            ? result.plan as Plan
            : null);
        }
      } catch (error) {
        if (!cancelled) {
          setPlan(null);
          setNotice(error instanceof Error ? error.message : "Could not load the saved plan.");
        }
      }
    }

    void loadSavedPlan();
    return () => { cancelled = true; };
  }, [selectedEventId]);

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? events[0];
  const visibleChatMessages = selectedEventId ? chatMessages : [];
  const totalBudget = events.reduce((sum, event) => sum + event.budget, 0);
  const totalGuests = events.reduce((sum, event) => sum + event.guests, 0);
  const upcomingEvents = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const theme = dark
    ? { page: "bg-[#0a0d14] text-slate-100", panel: "bg-[#111722] border-slate-800", muted: "text-slate-400", input: "bg-[#0b111b] border-slate-700 text-slate-100", nav: "text-slate-400 hover:bg-slate-800/70 hover:text-white", soft: "bg-slate-800/60", line: "border-slate-800" }
    : { page: "bg-slate-50 text-slate-900", panel: "bg-white border-slate-200", muted: "text-slate-500", input: "bg-white border-slate-300 text-slate-900", nav: "text-slate-600 hover:bg-slate-100 hover:text-slate-900", soft: "bg-slate-100", line: "border-slate-200" };

  async function submitAuth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAuthBusy(true); setAuthError("");
    try {
      const response = await fetch(`/api/auth/${authMode === "signup" ? "signup" : "login"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail.trim(), password: authPassword }),
      });
      const result = await response.json();
      if (!response.ok || !result?.user) throw new Error(result?.error ?? "Authentication failed.");
      setAuthUser(result.user); setAuthPassword(""); setAuthError(""); setEventsLoading(true);
      const eventsResponse = await fetch("/api/events", { cache: "no-store" });
      const eventsResult = await eventsResponse.json();
      if (!eventsResponse.ok || !Array.isArray(eventsResult.events)) throw new Error(eventsResult.error ?? "Could not load your events.");
      setEvents(eventsResult.events); setSelectedEventId(eventsResult.events[0]?.id ?? "");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Authentication failed. Please try again.");
      setAuthUser(null);
    } finally { setAuthBusy(false); setAuthLoading(false); setEventsLoading(false); }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setAuthUser(null); setEvents([]); setSelectedEventId(""); setPlan(null);
    setBudgetItems([]); setChecklistItems([]); setActiveSection("overview");
    setAuthEmail(""); setAuthPassword(""); setNotice("");
  }

  async function createEvent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const guestCount = Number(guests);
    const budgetAmount = Number(budget);

    if (!eventName.trim()) return setNotice("Please enter an event name.");
    if (!eventDate) return setNotice("Please select an event date.");
    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 5000) return setNotice("Guests must be a whole number from 1 to 5,000.");
    if (!Number.isInteger(budgetAmount) || budgetAmount < 1 || budgetAmount > 100000000) return setNotice("Budget must be a whole number from ₹1 to ₹10 crore.");

    try {
      const payload = {
        ...(editingEventId ? { id: editingEventId } : {}),
        name: eventName.trim(),
        type: eventType,
        date: eventDate,
        guests: guestCount,
        budget: budgetAmount,
      };
      const response = await fetch("/api/events", {
        method: editingEventId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success || !result.event) {
        throw new Error(result.error ?? "Could not create event.");
      }

      const savedEvent = result.event as EventItem;
      setEvents((previous) => editingEventId
        ? previous.map((item) => item.id === savedEvent.id ? savedEvent : item)
        : [savedEvent, ...previous.filter((item) => item.id !== savedEvent.id)]);
      setSelectedEventId(savedEvent.id);
      setEventName(""); setEventDate(""); setGuests("100"); setBudget("50000");
      setShowForm(false); setEditingEventId(null); setActiveSection("events"); setPlan(null);
      setNotice(editingEventId ? "Event updated and saved to the database." : "Event created successfully and saved to the database.");
      setEventsError("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create the event. Please try again.");
    }
  }

  async function deleteEvent(event: EventItem) {
    try {
      const response = await fetch(`/api/events?id=${encodeURIComponent(event.id)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error ?? "Could not delete event.");
      const remaining = events.filter((item) => item.id !== event.id);
      setEvents(remaining);
      if (selectedEventId === event.id) {
        setSelectedEventId(remaining[0]?.id ?? "");
        setPlan(null);
      }
      setNotice("Event deleted from the database.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not delete event.");
    }
  }

  async function saveBudgetItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedEvent) return setNotice("Create or select an event first.");
    const amount = Number(budgetAmount);
    if (!budgetCategory.trim()) return setNotice("Enter a budget category.");
    if (!Number.isSafeInteger(amount) || amount < 0) return setNotice("Enter a valid non-negative whole-number amount.");
    setSavingItem(true);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(selectedEvent.id)}/budget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: budgetCategory.trim(), amount }),
      });
      const result = await response.json();
      if (!response.ok || !result.item) throw new Error(result.error ?? "Could not save budget item.");
      setBudgetItems((items) => [...items.filter((item) => item.category !== result.item.category), result.item].sort((a, b) => a.category.localeCompare(b.category)));
      setBudgetCategory("");
      setBudgetAmount("");
      setNotice("Budget item saved to the database.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save budget item.");
    } finally {
      setSavingItem(false);
    }
  }

  async function removeBudgetItem(category: string) {
    if (!selectedEvent) return;
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(selectedEvent.id)}/budget?category=${encodeURIComponent(category)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error ?? "Could not delete budget item.");
      setBudgetItems((items) => items.filter((item) => item.category !== category));
      setNotice("Budget item deleted.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not delete budget item.");
    }
  }

  async function addChecklistItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedEvent) return setNotice("Create or select an event first.");
    if (!checklistTitle.trim()) return setNotice("Enter a checklist task.");
    setSavingItem(true);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(selectedEvent.id)}/checklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: checklistTitle.trim(), category: checklistCategory.trim() || "General" }),
      });
      const result = await response.json();
      if (!response.ok || !result.item) throw new Error(result.error ?? "Could not add checklist task.");
      setChecklistItems((items) => [...items, result.item]);
      setChecklistTitle("");
      setNotice("Checklist task saved to the database.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not add checklist task.");
    } finally {
      setSavingItem(false);
    }
  }

  async function toggleChecklistItem(item: ChecklistItem) {
    if (!selectedEvent) return;
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(selectedEvent.id)}/checklist`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, completed: !item.completed }),
      });
      const result = await response.json();
      if (!response.ok || !result.item) throw new Error(result.error ?? "Could not update checklist task.");
      setChecklistItems((items) => items.map((current) => current.id === item.id ? result.item : current));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update checklist task.");
    }
  }

  async function removeChecklistItem(itemId: string) {
    if (!selectedEvent) return;
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(selectedEvent.id)}/checklist?itemId=${encodeURIComponent(itemId)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error ?? "Could not delete checklist task.");
      setChecklistItems((items) => items.filter((item) => item.id !== itemId));
      setNotice("Checklist task deleted.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not delete checklist task.");
    }
  }

async function generatePlan() {
  if (planLoading) return;

  if (!selectedEvent) {
    setPlanError("Please create or select an event first.");
    return;
  }

  setPlanLoading(true);
  setPlanError("");
  setPlan(null);
  setNotice("Generating your event plan. Please wait...");

  console.log("[EventPilot] Generate clicked", selectedEvent);

  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      75000
    );

    let response: Response;

    try {
      response = await fetch("/api/plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(selectedEvent),
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeoutId);
    }

    const result = await response.json().catch(() => null);

    if (!response.ok || !result?.success) {
      throw new Error(
        result?.error ??
          `Plan API failed: HTTP ${response.status}`
      );
    }

    const raw = result.plan ?? result;

    const budgetBreakdown = (
      Array.isArray(raw.budgetBreakdown)
        ? raw.budgetBreakdown
        : []
    ).map((item: {
      category?: string;
      amount?: number;
      percent?: number;
      percentage?: number;
    }) => ({
      category: String(item.category ?? "Other"),
      amount: Number(item.amount) || 0,
      percent: Number(item.percent ?? item.percentage) || 0,
    }));

    const timeline = (
      Array.isArray(raw.timeline) ? raw.timeline : []
    ).map((item: {
      time?: string;
      date?: string;
      task?: string;
      daysBefore?: number;
      daysBeforeEvent?: number;
      priority?: string;
    }, index: number) => {
      
      const daysBefore =
        item.daysBeforeEvent ?? item.daysBefore;

      const formattedDate = item.date
        ? (() => {
            const [year, month, day] = item.date!.split("-").map(Number);
            return new Date(year, month - 1, day).toLocaleDateString(
              "en-IN",
              {
                day: "2-digit",
                month: "short",
                year: "numeric",
              }
            );
          })()
        : "";

      const relativeTime =
        item.time ??
        (daysBefore === undefined
          ? ""
          : daysBefore === 0
            ? "Event day"
            : `${daysBefore} days before`);

      const time = formattedDate
        ? `${formattedDate} · ${relativeTime}`
        : relativeTime || `Task ${index + 1}`;


      return {
        time,
        date: item.date,
        task: String(item.task ?? "Planning task"),
        priority: item.priority,
      };
    });

    const checklist = (
      Array.isArray(raw.checklist) ? raw.checklist : []
    ).map((item: string | {
      title?: string;
      task?: string;
      category?: string;
      priority?: string;
    }) => {
      if (typeof item === "string") return item;

      return [
        item.title ?? item.task ?? "Planning task",
        item.category,
        item.priority ? `${item.priority} priority` : "",
      ].filter(Boolean).join(" · ");
    });

    setPlan({
      summary: String(
        raw.summary ??
          `Starter plan for ${selectedEvent.name}`
      ),
      budgetBreakdown,
      timeline,
      checklist,
      ideas: Array.isArray(raw.ideas)
        ? raw.ideas.map(String)
        : [],
      notes: Array.isArray(raw.notes)
        ? raw.notes.map(String)
        : [],
      theme: typeof raw.theme === "string"
        ? raw.theme
        : "",
      colorPalette: Array.isArray(raw.colorPalette)
        ? raw.colorPalette.map(String)
        : Array.isArray(raw.colors)
          ? raw.colors.map(String)
          : [],
      decoration: Array.isArray(raw.decoration)
        ? raw.decoration.map(String)
        : Array.isArray(raw.decorationIdeas)
          ? raw.decorationIdeas.map(String)
          : [],
      food: Array.isArray(raw.food)
        ? raw.food.map(String)
        : Array.isArray(raw.foodIdeas)
          ? raw.foodIdeas.map(String)
          : [],
      entertainment: Array.isArray(raw.entertainment)
        ? raw.entertainment.map(String)
        : Array.isArray(raw.entertainmentIdeas)
          ? raw.entertainmentIdeas.map(String)
          : [],
      savingsTips: Array.isArray(raw.savingsTips)
        ? raw.savingsTips.map(String)
        : Array.isArray(raw.budgetTips)
          ? raw.budgetTips.map(String)
          : [],
    });

    setNotice("Event plan generated successfully.");
    console.log("[EventPilot] Plan generated", result.meta);
  } catch (error) {
    const message =
      error instanceof Error &&
      error.name === "AbortError"
        ? "Generation timed out. Check that Ollama is running."
        : error instanceof Error
          ? error.message
          : "Could not generate the plan.";

    console.error("[EventPilot] Plan generation failed:", error);
    setPlanError(message);
    setNotice("");
  } finally {
    setPlanLoading(false);
  }
}

  const vendorCount = checklistItems.length;
  const checkedCount = checklistItems.filter((item) => item.completed).length;
  const completion = vendorCount ? Math.round((checkedCount / vendorCount) * 100) : 0;
  const pageTitle = navItems.find((item) => item.id === activeSection)?.label ?? "Overview";

  if (authLoading) return <main className={`flex min-h-screen items-center justify-center ${theme.page}`}><p className="text-sm">Checking your EventPilot account…</p></main>;

  if (!authUser) return (
    <main className={`flex min-h-screen items-center justify-center px-4 py-10 ${theme.page}`}>
      <div className={`w-full max-w-md rounded-3xl border ${theme.line} ${theme.panel} p-7 shadow-2xl`}>
        <div className="mb-7 flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-2xl text-white">✦</div><div><h1 className="text-2xl font-bold">EventPilot <span className="text-violet-400">AI</span></h1><p className={`text-xs ${theme.muted}`}>Your personal event planning workspace</p></div></div>
        <div className="mb-6 flex items-center justify-between"><div><h2 className="text-xl font-bold">{authMode === "login" ? "Welcome back" : "Create your account"}</h2><p className={`mt-1 text-sm ${theme.muted}`}>{authMode === "login" ? "Sign in to continue planning." : "Start planning your events today."}</p></div><button onClick={() => setDark(!dark)} className={`rounded-xl border ${theme.line} px-3 py-2 text-sm`}>{dark ? "☀️" : "🌙"}</button></div>
        <form onSubmit={submitAuth} className="space-y-4"><div><label htmlFor="auth-email" className="mb-2 block text-sm font-semibold">Email address</label><input id="auth-email" type="email" autoComplete="email" required value={authEmail} onChange={e => setAuthEmail(e.target.value)} className={`w-full rounded-xl border ${theme.input} px-4 py-3 outline-none focus:border-violet-500`} placeholder="you@example.com" /></div><div><label htmlFor="auth-password" className="mb-2 block text-sm font-semibold">Password</label><input id="auth-password" type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} minLength={8} maxLength={128} required value={authPassword} onChange={e => setAuthPassword(e.target.value)} className={`w-full rounded-xl border ${theme.input} px-4 py-3 outline-none focus:border-violet-500`} placeholder="At least 8 characters" /></div>
          {authError && <p role="alert" className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-400">{authError}</p>}
          <button disabled={authBusy} className="w-full rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white disabled:opacity-60">{authBusy ? "Please wait…" : authMode === "login" ? "Sign in →" : "Create account →"}</button></form>
        <p className={`mt-6 text-center text-sm ${theme.muted}`}>{authMode === "login" ? "New to EventPilot?" : "Already have an account?"} <button onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setAuthError(""); }} className="font-semibold text-violet-400">{authMode === "login" ? "Create account" : "Sign in"}</button></p>
      </div>
    </main>
  );

  return (
    <main className={`min-h-screen ${theme.page}`}>
      <div className="mx-auto flex min-h-screen max-w-[1700px]">
        <aside className={`fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col border-r ${theme.line} ${dark ? "bg-[#0d121c]" : "bg-white"} p-5 transition-transform lg:static lg:translate-x-0 ${mobileNav ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="mb-10 flex items-center gap-3 px-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-xl font-black text-white shadow-lg shadow-violet-900/30">✦</div>
            <div><p className="text-lg font-bold tracking-tight">EventPilot <span className="text-violet-400">AI</span></p><p className={`text-xs ${theme.muted}`}>Plan smarter. Celebrate more.</p></div>
          </div>
          <p className={`mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.2em] ${theme.muted}`}>Workspace</p>
          <nav className="space-y-1">
            {navItems.map((item) => <button key={item.id} onClick={() => { setActiveSection(item.id); setMobileNav(false); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition ${activeSection === item.id ? "bg-violet-600 text-white shadow-lg shadow-violet-950/30" : theme.nav}`}><span className="w-5 text-center text-base">{item.icon}</span>{item.label}{item.id === "copilot" && <span className="ml-auto rounded-md bg-fuchsia-500/20 px-2 py-0.5 text-[10px] text-fuchsia-300">BETA</span>}</button>)}
          </nav>
          <div className={`mt-auto rounded-2xl border ${theme.line} ${theme.soft} p-4`}><div className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className="text-violet-400">✦</span> AI integration</div><p className={`text-xs leading-5 ${theme.muted}`}>Events are loaded and saved through the database API. The planning API is configured to use your local Ollama model.</p><div title={ollamaStatus.message} className={`mt-3 inline-flex max-w-full items-center gap-2 rounded-full px-2.5 py-1 text-[10px] font-semibold ${ollamaStatus.status === "online" && ollamaStatus.modelAvailable ? "bg-emerald-500/10 text-emerald-400" : ollamaStatus.status === "offline" || (ollamaStatus.status === "online" && ollamaStatus.modelAvailable === false) ? "bg-rose-500/10 text-rose-400" : "bg-amber-500/10 text-amber-400"}`}><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ollamaStatus.status === "online" && ollamaStatus.modelAvailable ? "bg-emerald-400" : ollamaStatus.status === "offline" || (ollamaStatus.status === "online" && ollamaStatus.modelAvailable === false) ? "bg-rose-400" : "bg-amber-400"}`} />{ollamaStatus.status === "unknown" ? "Checking Ollama…" : ollamaStatus.status === "offline" ? "Ollama offline" : ollamaStatus.modelAvailable ? "Ollama online · Model ready" : "Ollama online · Model missing"}</div><p className={`mt-2 break-words text-[10px] ${theme.muted}`}>{ollamaStatus.model} · {ollamaStatus.message}</p></div>
        </aside>
        {mobileNav && <button aria-label="Close navigation" onClick={() => setMobileNav(false)} className="fixed inset-0 z-30 bg-black/50 lg:hidden" />}

        <section className="min-w-0 flex-1">
          <header className={`sticky top-0 z-20 flex h-[76px] items-center justify-between border-b ${theme.line} ${dark ? "bg-[#0a0d14]/90" : "bg-white/90"} px-5 backdrop-blur-xl sm:px-8`}>
            <div className="flex items-center gap-3"><button className={`rounded-lg p-2 ${theme.nav} lg:hidden`} onClick={() => setMobileNav(true)} aria-label="Open navigation">☰</button><div><p className={`text-xs ${theme.muted}`}>Workspace / <span className={dark ? "text-slate-200" : "text-slate-700"}>{pageTitle}</span></p><h1 className="mt-0.5 text-lg font-bold sm:text-xl">{pageTitle}</h1></div></div>
            <div className="flex items-center gap-2 sm:gap-3"><span className={`hidden text-xs sm:inline ${theme.muted}`}>{new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span><span className={`hidden max-w-[150px] truncate text-xs ${theme.muted} md:inline`}>{authUser.email}</span><button onClick={logout} className={`rounded-xl border ${theme.line} ${theme.panel} px-3 py-2 text-sm`}>Log out</button><button onClick={() => setDark(!dark)} className={`rounded-xl border ${theme.line} ${theme.panel} px-3 py-2 text-sm`} aria-label="Toggle theme">{dark ? "☀️ Light" : "🌙 Dark"}</button><button onClick={() => { setEditingEventId(null); setEventName(""); setEventType("Wedding"); setEventDate(""); setGuests("100"); setBudget("50000"); setShowForm(true); setNotice(""); }} className="rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-950/20 hover:bg-violet-500 sm:px-4">+ <span className="hidden sm:inline">Add event</span><span className="sm:hidden">Add</span></button></div>
          </header>

          <div className="mx-auto max-w-[1450px] space-y-7 p-5 sm:p-8">
            {eventsError && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{eventsError} Check DATABASE_URL, Prisma migration, and /api/events.</div>}
            {eventsLoading && <div role="status" className={`rounded-xl border ${theme.line} ${theme.panel} px-4 py-3 text-sm ${theme.muted}`}>Loading events from database…</div>}
            {notice && <div role="status" className={`flex items-center justify-between rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-300`}>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification">×</button></div>}
            {activeSection === "overview" && <>
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="mb-2 text-sm font-semibold text-violet-400">YOUR EVENT COMMAND CENTER</p><h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Make every moment <span className="text-violet-400">memorable.</span></h2><p className={`mt-3 max-w-2xl text-sm leading-6 ${theme.muted}`}>Plan events, keep budgets on track, and organize every moving part from one calm workspace.</p></div><button onClick={() => { setEditingEventId(null); setEventName(""); setEventType("Wedding"); setEventDate(""); setGuests("100"); setBudget("50000"); setShowForm(true); setNotice(""); }} className={`rounded-xl border ${theme.line} ${theme.panel} px-4 py-3 text-sm font-semibold hover:border-violet-500`}>＋ Create an event</button></div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
                { label: "Total events", value: events.length.toString(), icon: "▦", hint: "In your workspace" },
                { label: "Total guests", value: totalGuests.toLocaleString("en-IN"), icon: "♙", hint: "Across all events" },
                { label: "Planned budget", value: currency(totalBudget), icon: "₹", hint: "Combined event budgets" },
                { label: "Vendor checklist", value: `${checkedCount}/${vendorCount || 0}`, icon: "✓", hint: `${completion}% completed` },
              ].map((stat) => <div key={stat.label} className={`rounded-2xl border ${theme.line} ${theme.panel} p-5 sm:p-6`}><div className="flex items-start justify-between"><p className={`text-sm ${theme.muted}`}>{stat.label}</p><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-lg text-violet-400">{stat.icon}</span></div><p className="mt-4 break-words text-2xl font-bold sm:text-3xl">{stat.value}</p><p className={`mt-2 text-xs ${theme.muted}`}>{stat.hint}</p></div>)}</div>
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-violet-700 via-violet-600 to-fuchsia-600 p-6 sm:p-8"><div className="absolute -right-10 -top-16 h-64 w-64 rounded-full border-[35px] border-white/10"/><div className="absolute right-24 top-20 h-24 w-24 rounded-full bg-white/10 blur-2xl"/><div className="relative max-w-3xl"><span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold text-violet-50">✦ YOUR PLANNING COPILOT</span><h3 className="mt-4 text-2xl font-bold sm:text-3xl">Your next great event starts here.</h3><p className="mt-3 max-w-xl text-sm leading-6 text-violet-100">Generate a personalized event plan with your local AI model, including budget estimates, a timeline, a checklist, and creative ideas.</p><button onClick={() => { setActiveSection("copilot"); if (!selectedEvent && events.length) setSelectedEventId(events[0].id); }} className="mt-5 rounded-xl bg-white px-4 py-3 text-sm font-bold text-violet-700 hover:bg-violet-50">Explore AI Co-Pilot ↗</button></div></div>
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_0.65fr]"><div className={`min-w-0 rounded-2xl border ${theme.line} ${theme.panel} p-5 sm:p-6`}><div className="mb-5 flex items-center justify-between gap-3"><div><h3 className="text-lg font-bold">Your events</h3><p className={`mt-1 text-sm ${theme.muted}`}>Keep every celebration organized.</p></div><button onClick={() => setActiveSection("events")} className="shrink-0 text-sm font-semibold text-violet-400">View all ↗</button></div><div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">{upcomingEvents.slice(0, 4).map((event) => <EventCard key={event.id} event={event} theme={theme} onSelect={() => { setSelectedEventId(event.id); setActiveSection("copilot"); }} />)}</div></div><div className={`rounded-2xl border ${theme.line} ${theme.panel} p-5 sm:p-6`}><h3 className="text-lg font-bold">Budget snapshot</h3><p className={`mt-1 text-sm ${theme.muted}`}>Combined planned budgets</p><p className="mt-5 text-3xl font-bold">{currency(totalBudget)}</p><div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-700/40"><div className="h-full w-[68%] rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"/></div><div className={`mt-3 flex justify-between text-xs ${theme.muted}`}><span>Planning overview</span><span>Sample estimate</span></div><button onClick={() => setActiveSection("budget")} className={`mt-6 w-full rounded-xl border ${theme.line} px-4 py-3 text-sm font-semibold hover:border-violet-500`}>Open budget planner →</button></div></div>
            </>}

            {activeSection === "events" && <><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h2 className="text-2xl font-bold">Your events</h2><p className={`mt-2 text-sm ${theme.muted}`}>Choose an event to build its plan, or create another event.</p></div><button onClick={() => { setEditingEventId(null); setEventName(""); setEventType("Wedding"); setEventDate(""); setGuests("100"); setBudget("50000"); setShowForm(true); setNotice(""); }} className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white">＋ Add event</button></div>{events.length ? <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3">{upcomingEvents.map((event) => <EventCard key={event.id} event={event} theme={theme} onSelect={() => { setSelectedEventId(event.id); setActiveSection("copilot"); }} onEdit={() => { setEditingEventId(event.id); setEventName(event.name); setEventType(event.type); setEventDate(event.date); setGuests(String(event.guests)); setBudget(String(event.budget)); setNotice(""); setShowForm(true); }} onDelete={() => { void deleteEvent(event); }} />)}</div> : <EmptyState theme={theme} text="No events yet. Create your first event to get started." onClick={() => setShowForm(true)} />}</>}

            {activeSection === "budget" && <><SectionIntro title="Budget planner" subtitle="Manage budget allocations saved to the database for each event." theme={theme}/><EventPicker events={events} selectedId={selectedEventId} onChange={setSelectedEventId} theme={theme}/>{selectedEvent && <div className={`rounded-2xl border ${theme.line} ${theme.panel} p-5 sm:p-7`}><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><h3 className="text-xl font-bold">{selectedEvent.name}</h3><p className={`mt-1 text-sm ${theme.muted}`}>{selectedEvent.guests} guests · Total budget {currency(selectedEvent.budget)}</p></div><div className="text-right"><p className={`text-xs ${theme.muted}`}>Allocated</p><p className="text-lg font-bold">{currency(budgetItems.reduce((sum, item) => sum + item.amount, 0))}</p><p className={`text-xs ${theme.muted}`}>Remaining: {currency(selectedEvent.budget - budgetItems.reduce((sum, item) => sum + item.amount, 0))}</p></div></div><form onSubmit={saveBudgetItem} className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px_auto]"><input aria-label="Budget category" value={budgetCategory} onChange={(e) => setBudgetCategory(e.target.value)} placeholder="Category (e.g. Venue)" maxLength={80} required className={`min-w-0 rounded-xl border ${theme.input} px-4 py-3 outline-none focus:border-violet-500`}/><input aria-label="Budget amount in INR" type="number" min={0} step={1} value={budgetAmount} onChange={(e) => setBudgetAmount(e.target.value)} placeholder="Amount (₹)" required className={`min-w-0 rounded-xl border ${theme.input} px-4 py-3 outline-none focus:border-violet-500`}/><button disabled={savingItem} className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">{savingItem ? "Saving…" : "Save allocation"}</button></form>{budgetLoading ? <p className={`mt-5 text-sm ${theme.muted}`}>Loading budget items…</p> : budgetItems.length ? <div className="mt-6 space-y-3">{budgetItems.map((item) => <div key={item.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl ${theme.soft} p-4`}><div><p className="font-semibold">{item.category}</p><p className={`mt-1 text-sm ${theme.muted}`}>{currency(item.amount)}</p></div><button onClick={() => void removeBudgetItem(item.category)} className="rounded-lg border border-rose-500/30 px-3 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/10">Delete</button></div>)}</div> : <p className={`mt-5 rounded-xl ${theme.soft} p-4 text-sm ${theme.muted}`}>No budget allocations yet. Add your first category above.</p>}</div>}</>}

            {activeSection === "timeline" && <><SectionIntro title="Timeline & tasks" subtitle="A practical starter timeline to keep your event preparation moving." theme={theme}/><EventPicker events={events} selectedId={selectedEventId} onChange={setSelectedEventId} theme={theme}/><div className={`rounded-2xl border ${theme.line} ${theme.panel} p-5 sm:p-7`}><h3 className="text-lg font-bold">Planning timeline</h3><p className={`mt-1 text-sm ${theme.muted}`}>{selectedEvent ? `${selectedEvent.name} · ${selectedEvent.date}` : "Create an event to begin."}</p><div className="mt-6 space-y-5">{(plan?.timeline ?? [{time:"6–8 weeks before",task:"Confirm goals, guest count, and overall budget."},{time:"4–6 weeks before",task:"Shortlist venue, catering, and key vendors."},{time:"2–3 weeks before",task:"Confirm invitations, schedule, and event requirements."},{time:"1 week before",task:"Reconfirm vendors, guest count, and payment milestones."},{time:"Event day",task:"Follow the run sheet and track final setup checks."}]).map((item, index) => <div key={`${item.time}-${item.task}-${index}`} className="flex gap-4"><div className="flex flex-col items-center"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-sm font-bold text-violet-400">{index+1}</div>{index < 4 && <div className={`mt-2 h-full min-h-8 w-px ${theme.line} border-l`}/>}</div><div className="pb-4"><p className="font-semibold">{item.time}</p><p className={`mt-1 text-sm leading-6 ${theme.muted}`}>{item.task}</p></div></div>)}</div><section className={`mt-6 rounded-2xl border ${theme.line} ${theme.panel} p-5 sm:p-6`}>
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-400">LIVE AI CHAT</p><h3 className="mt-1 text-lg font-bold">Chat with EventPilot</h3><p className={`mt-1 text-xs ${theme.muted}`}>Ask about this event&apos;s budget, checklist, timeline, theme or planning decisions.</p></div>
    <div className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs ${ollamaStatus.status === "online" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>{ollamaStatus.status === "online" ? "Ollama online" : "Ollama offline"}</span><button type="button" onClick={clearCopilotChat} disabled={clearingChat || chatLoading || visibleChatMessages.length === 0} className={`rounded-lg border ${theme.line} px-3 py-2 text-xs font-semibold disabled:opacity-40`}>{clearingChat ? "Clearing…" : "Clear chat"}</button></div>
  </div>
  <div className={`mt-4 h-[340px] space-y-3 overflow-y-auto rounded-xl ${theme.soft} p-3 sm:p-4`} aria-live="polite">
    {chatHistoryLoading && <p className={`py-3 text-center text-sm ${theme.muted}`}>Loading saved conversation…</p>}
    {!chatHistoryLoading && visibleChatMessages.length === 0 && <div className={`flex h-full flex-col items-center justify-center text-center ${theme.muted}`}><span className="text-3xl">✦</span><p className="mt-2 font-semibold">Your event planning assistant is ready</p><p className="mt-1 max-w-sm text-sm">Try: “How should I divide my budget?” or “What tasks should I finish first?”</p></div>}
    {visibleChatMessages.map((message, index) => <div key={message.id ?? `${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "bg-violet-600 text-white" : `${theme.panel} border ${theme.line}`}`}><p className="mb-1 text-[10px] font-bold uppercase tracking-wider opacity-70">{message.role === "user" ? "You" : "EventPilot AI"}</p>{message.content}</div></div>)}
    {chatLoading && <div className={`w-fit rounded-2xl border ${theme.line} ${theme.panel} px-4 py-3 text-sm ${theme.muted}`}>EventPilot is thinking…</div>}
  </div>
  {chatError && <p role="alert" className="mt-3 text-sm text-rose-400">{chatError}</p>}
  <form onSubmit={sendCopilotMessage} className="mt-3 flex flex-col gap-2 sm:flex-row"><input value={chatInput} onChange={(e) => setChatInput(e.target.value)} maxLength={2000} placeholder="Ask anything about your event…" className={`min-w-0 flex-1 rounded-xl border ${theme.input} p-3 outline-none focus:border-violet-500`} disabled={!selectedEvent || chatLoading}/><button type="submit" disabled={!selectedEvent || !chatInput.trim() || chatLoading} className="rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white disabled:opacity-50">{chatLoading ? "Sending…" : "Send message ↗"}</button></form>
  <p className={`mt-2 text-xs ${theme.muted}`}>Conversation is saved to this event. AI suggestions are not automatic bookings or database changes.</p>
</section>
<button onClick={generatePlan} disabled={!selectedEvent || planLoading} className="mt-3 rounded-xl border border-violet-500/40 px-4 py-3 text-sm font-semibold text-violet-400">{planLoading ? "Preparing…" : "Personalize timeline"}</button></div></>}

            {activeSection === "vendors" && <><SectionIntro title="Vendor checklist" subtitle="Add vendor and planning tasks. Completion status is saved in the database for the selected event." theme={theme}/><EventPicker events={events} selectedId={selectedEventId} onChange={setSelectedEventId} theme={theme}/>{selectedEvent && <><div className={`my-5 rounded-2xl border ${theme.line} ${theme.panel} p-5`}><div className="flex items-center justify-between gap-3"><div><p className="font-semibold">Checklist progress</p><p className={`mt-1 text-sm ${theme.muted}`}>{checkedCount} of {vendorCount} tasks completed</p></div><p className="text-2xl font-bold text-violet-400">{completion}%</p></div><div className="mt-4 h-2 rounded-full bg-slate-700/40"><div className="h-2 rounded-full bg-violet-500 transition-all" style={{width:`${completion}%`}}/></div><form onSubmit={addChecklistItem} className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px_auto]"><input aria-label="Checklist task" value={checklistTitle} onChange={(e) => setChecklistTitle(e.target.value)} placeholder="Task (e.g. Confirm venue)" maxLength={200} required className={`min-w-0 rounded-xl border ${theme.input} px-4 py-3 outline-none focus:border-violet-500`}/><input aria-label="Task category" value={checklistCategory} onChange={(e) => setChecklistCategory(e.target.value)} placeholder="Category" maxLength={80} className={`min-w-0 rounded-xl border ${theme.input} px-4 py-3 outline-none focus:border-violet-500`}/><button disabled={savingItem} className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">{savingItem ? "Saving…" : "Add task"}</button></form></div>{checklistLoading ? <p className={`text-sm ${theme.muted}`}>Loading checklist…</p> : checklistItems.length ? <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{checklistItems.map((item) => <div key={item.id} className={`flex items-start gap-3 rounded-2xl border ${theme.line} ${theme.panel} p-4`}><input aria-label={`Mark ${item.title} complete`} type="checkbox" checked={item.completed} onChange={() => void toggleChecklistItem(item)} className="mt-1 h-4 w-4 accent-violet-500"/><div className="min-w-0 flex-1"><p className={`break-words font-semibold ${item.completed ? "line-through opacity-60" : ""}`}>{item.title}</p><p className={`mt-1 text-xs ${theme.muted}`}>{item.category}</p></div><button onClick={() => void removeChecklistItem(item.id)} className="rounded-lg border border-rose-500/30 px-3 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/10">Delete</button></div>)}</div> : <div className={`rounded-2xl border border-dashed ${theme.line} ${theme.panel} p-8 text-center`}><p className={`text-sm ${theme.muted}`}>No checklist tasks yet. Add your first task above.</p></div>}</>}</>}

            {activeSection === "copilot" && <><SectionIntro title="AI Co-Pilot" subtitle="Generate a personalized plan with your local Ollama model, plus practical budget and timeline guidance." theme={theme}/>{events.length > 0 ? <div className={`rounded-2xl border ${theme.line} ${theme.panel} p-5 sm:p-7`}><label className={`mb-2 block text-sm font-semibold ${theme.muted}`} htmlFor="selected-event">Choose an event</label><select id="selected-event" value={selectedEventId} onChange={(e) => { setSelectedEventId(e.target.value); setPlan(null); }} className={`w-full rounded-xl border ${theme.input} p-3 outline-none focus:border-violet-500`}>{events.map((event) => <option key={event.id} value={event.id}>{event.name} — {event.type}</option>)}</select>{selectedEvent && <div className={`mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3`}><MiniInfo label="Date" value={selectedEvent.date} theme={theme}/><MiniInfo label="Guests" value={selectedEvent.guests.toLocaleString("en-IN")} theme={theme}/><MiniInfo label="Budget" value={currency(selectedEvent.budget)} theme={theme}/></div>}<section className={`mt-6 rounded-2xl border ${theme.line} ${theme.panel} p-5 sm:p-6`}>
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-400">LIVE AI CHAT</p><h3 className="mt-1 text-lg font-bold">Chat with EventPilot</h3><p className={`mt-1 text-xs ${theme.muted}`}>Ask about this event&apos;s budget, checklist, timeline, theme or planning decisions.</p></div>
    <div className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs ${ollamaStatus.status === "online" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>{ollamaStatus.status === "online" ? "Ollama online" : "Ollama offline"}</span><button type="button" onClick={clearCopilotChat} disabled={clearingChat || chatLoading || visibleChatMessages.length === 0} className={`rounded-lg border ${theme.line} px-3 py-2 text-xs font-semibold disabled:opacity-40`}>{clearingChat ? "Clearing…" : "Clear chat"}</button></div>
  </div>
  <div className={`mt-4 h-[340px] space-y-3 overflow-y-auto rounded-xl ${theme.soft} p-3 sm:p-4`} aria-live="polite">
    {chatHistoryLoading && <p className={`py-3 text-center text-sm ${theme.muted}`}>Loading saved conversation…</p>}
    {!chatHistoryLoading && visibleChatMessages.length === 0 && <div className={`flex h-full flex-col items-center justify-center text-center ${theme.muted}`}><span className="text-3xl">✦</span><p className="mt-2 font-semibold">Your event planning assistant is ready</p><p className="mt-1 max-w-sm text-sm">Try: “How should I divide my budget?” or “What tasks should I finish first?”</p></div>}
    {visibleChatMessages.map((message, index) => <div key={message.id ?? `${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "bg-violet-600 text-white" : `${theme.panel} border ${theme.line}`}`}><p className="mb-1 text-[10px] font-bold uppercase tracking-wider opacity-70">{message.role === "user" ? "You" : "EventPilot AI"}</p>{message.content}</div></div>)}
    {chatLoading && <div className={`w-fit rounded-2xl border ${theme.line} ${theme.panel} px-4 py-3 text-sm ${theme.muted}`}>EventPilot is thinking…</div>}
  </div>
  {chatError && <p role="alert" className="mt-3 text-sm text-rose-400">{chatError}</p>}
  <form onSubmit={sendCopilotMessage} className="mt-3 flex flex-col gap-2 sm:flex-row"><input value={chatInput} onChange={(e) => setChatInput(e.target.value)} maxLength={2000} placeholder="Ask anything about your event…" className={`min-w-0 flex-1 rounded-xl border ${theme.input} p-3 outline-none focus:border-violet-500`} disabled={!selectedEvent || chatLoading}/><button type="submit" disabled={!selectedEvent || !chatInput.trim() || chatLoading} className="rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white disabled:opacity-50">{chatLoading ? "Sending…" : "Send message ↗"}</button></form>
  <p className={`mt-2 text-xs ${theme.muted}`}>Conversation is saved to this event. AI suggestions are not automatic bookings or database changes.</p>
</section>
<button onClick={generatePlan} disabled={!selectedEvent || planLoading} className="mt-5 rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white disabled:opacity-60">{planLoading ? "Building your plan…" : "✦ Generate event plan"}</button>{planError && <p role="alert" className="mt-4 text-sm text-rose-400">{planError}</p>}{plan && <div className="mt-7 space-y-6"><div><h3 className="text-xl font-bold">Your starter plan</h3><p className={`mt-2 text-sm leading-6 ${theme.muted}`}>{plan.summary}</p></div><div><h4 className="mb-3 font-bold">Budget breakdown</h4><BudgetTable breakdown={plan.budgetBreakdown} total={selectedEvent.budget} theme={theme}/></div><div><h4 className="mb-3 font-bold">Timeline</h4><div className="space-y-3">{plan.timeline.map((item, index) => <div key={`${item.time}-${item.task}-${index}`} className={`rounded-xl ${theme.soft} p-4`}><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{item.time}</p>{item.priority && <span className={`rounded-full px-2 py-1 text-xs ${item.priority.toLowerCase() === "high" ? "bg-rose-500/10 text-rose-400" : "bg-amber-500/10 text-amber-400"}`}>{item.priority} priority</span>}</div><p className={`mt-1 text-sm ${theme.muted}`}>{item.task}</p></div>)}</div></div><div><h4 className="mb-3 font-bold">Starter checklist</h4><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{plan.checklist.map((task, index) => <div key={`${task}-${index}`} className={`rounded-xl ${theme.soft} p-3 text-sm`}>☐ {task}</div>) }</div></div>{(plan.theme || plan.colorPalette?.length || plan.decoration?.length || plan.food?.length || plan.entertainment?.length || plan.savingsTips?.length) && <section className={`rounded-2xl border ${theme.line} ${theme.panel} p-5 sm:p-6`}><div className="mb-4"><p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-400">AI DESIGN STUDIO</p><h4 className="mt-1 text-lg font-bold">Your personalized event concept</h4>{plan.theme && <p className={`mt-2 text-sm leading-6 ${theme.muted}`}>{plan.theme}</p>}</div>{Boolean(plan.colorPalette?.length) && <div className="mb-5"><p className="mb-2 text-sm font-semibold">Colour palette</p><div className="flex flex-wrap gap-2">{plan.colorPalette!.map((color, index) => <span key={`${color}-${index}`} className={`rounded-full border ${theme.line} ${theme.soft} px-3 py-1.5 text-xs font-medium`}>{color}</span>)}</div></div>}<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{([{title:"Decoration ideas",items:plan.decoration},{title:"Food & catering",items:plan.food},{title:"Entertainment",items:plan.entertainment},{title:"Budget-saving tips",items:plan.savingsTips}] as {title:string;items?:string[]}[]).filter((section) => section.items?.length).map((section) => <div key={section.title} className={`rounded-xl ${theme.soft} p-4`}><h5 className="mb-2 font-semibold">{section.title}</h5><ul className={`list-disc space-y-1.5 pl-5 text-sm ${theme.muted}`}>{section.items!.map((item,index)=><li key={`${item}-${index}`}>{item}</li>)}</ul></div>)}</div></section>}{Boolean(plan.ideas?.length) && <div><h4 className="mb-3 font-bold">Personalized ideas</h4><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{plan.ideas!.map((idea, index) => <div key={`${idea}-${index}`} className={`rounded-xl ${theme.soft} p-3 text-sm`}>✦ {idea}</div>)}</div></div>}{Boolean(plan.notes?.length) && <div><h4 className="mb-2 font-bold">Planning notes</h4><ul className={`list-disc space-y-1 pl-5 text-sm ${theme.muted}`}>{plan.notes!.map((note, index) => <li key={`${note}-${index}`}>{note}</li>)}</ul></div>}<p className={`text-xs ${theme.muted}`}>Planning estimates only. Confirm costs, availability, contracts, and local requirements independently.</p></div>}</div> : <EmptyState theme={theme} text="Create an event before generating a plan." onClick={() => setShowForm(true)}/>}</>}
          </div>
          <footer className={`border-t ${theme.line} px-5 py-5 text-center text-xs ${theme.muted} sm:px-8`}>EventPilot AI · Local AI planning workspace · Estimates should be verified</footer>
        </section>
      </div>

      {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}><div role="dialog" aria-modal="true" aria-labelledby="create-event-title" className={`my-6 w-full max-w-xl rounded-3xl border ${theme.line} ${dark ? "bg-[#111722]" : "bg-white"} p-5 shadow-2xl sm:p-7`}><div className="mb-6 flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-400">LET&apos;S GET PLANNING</p><h2 id="create-event-title" className="mt-2 text-2xl font-bold">{editingEventId ? "Edit event" : "Create a new event"}</h2><p className={`mt-2 text-sm ${theme.muted}`}>Add the basics. You can build the plan afterwards.</p></div><button onClick={() => { setShowForm(false); setEditingEventId(null); }} className={`rounded-lg px-3 py-1 text-xl ${theme.nav}`} aria-label="Close form">×</button></div><form onSubmit={createEvent} className="space-y-5"><div><label htmlFor="event-name" className="mb-2 block text-sm font-semibold">Event name</label><input id="event-name" autoFocus required maxLength={100} value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="e.g. Annual team celebration" className={`w-full rounded-xl border ${theme.input} px-4 py-3 outline-none focus:border-violet-500`}/></div><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div><label htmlFor="event-type" className="mb-2 block text-sm font-semibold">Event type</label><select id="event-type" value={eventType} onChange={(e) => setEventType(e.target.value)} className={`w-full rounded-xl border ${theme.input} px-3 py-3 outline-none focus:border-violet-500`}>{["Wedding","Birthday","Corporate","Community","Conference","Festival","Other"].map((type) => <option key={type}>{type}</option>)}</select></div><div><label htmlFor="event-date" className="mb-2 block text-sm font-semibold">Event date</label><input id="event-date" required type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className={`w-full min-w-0 rounded-xl border ${theme.input} px-3 py-3 outline-none focus:border-violet-500`}/></div></div><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div><label htmlFor="event-guests" className="mb-2 block text-sm font-semibold">Expected guests</label><input id="event-guests" required type="number" inputMode="numeric" min={1} max={5000} step={1} value={guests} onChange={(e) => setGuests(e.target.value)} className={`w-full rounded-xl border ${theme.input} px-4 py-3 outline-none focus:border-violet-500`}/><p className={`mt-1 text-xs ${theme.muted}`}>1–5,000 people</p></div><div><label htmlFor="event-budget" className="mb-2 block text-sm font-semibold">Budget (INR)</label><input id="event-budget" required type="number" inputMode="numeric" min={1} max={100000000} step={1} value={budget} onChange={(e) => setBudget(e.target.value)} className={`w-full rounded-xl border ${theme.input} px-4 py-3 outline-none focus:border-violet-500`}/><p className={`mt-1 text-xs ${theme.muted}`}>₹1–₹10 crore</p></div></div>{notice && <p role="alert" className="text-sm text-rose-400">{notice}</p>}<div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => { setShowForm(false); setEditingEventId(null); }} className={`rounded-xl border ${theme.line} px-5 py-3 text-sm font-semibold`}>Cancel</button><button type="submit" className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white hover:bg-violet-500">{editingEventId ? "Save changes →" : "Create event →"}</button></div></form></div></div>}
    </main>
  );
}

function EventCard({ event, theme, onSelect, onEdit, onDelete }: { event: EventItem; theme: { panel: string; line: string; muted: string; soft: string }; onSelect: () => void; onEdit?: () => void; onDelete?: () => void }) {
  return <article className={`min-w-0 rounded-2xl border ${theme.line} ${theme.panel} p-5 transition hover:border-violet-500/50 sm:p-6`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="inline-flex rounded-full bg-violet-500/10 px-2.5 py-1 text-[11px] font-semibold text-violet-400">{event.type}</span><h3 className="mt-3 break-words text-lg font-bold">{event.name}</h3></div><span className="text-xl text-violet-400">✦</span></div><div className={`mt-5 grid grid-cols-2 gap-3`}><div className={`rounded-xl ${theme.soft} p-3`}><p className={`text-xs ${theme.muted}`}>Event date</p><p className="mt-1 break-words text-sm font-semibold">{event.date}</p></div><div className={`rounded-xl ${theme.soft} p-3`}><p className={`text-xs ${theme.muted}`}>Guests</p><p className="mt-1 text-sm font-semibold">{event.guests.toLocaleString("en-IN")}</p></div></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div><p className={`text-xs ${theme.muted}`}>Planned budget</p><p className="mt-1 text-lg font-bold">{currency(event.budget)}</p></div><div className="flex flex-wrap items-center gap-2"><button onClick={onSelect} className="rounded-xl bg-violet-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-violet-500">Build plan ↗</button>{onEdit && <button onClick={onEdit} className="rounded-xl border border-slate-500/30 px-3 py-2.5 text-xs font-semibold">Edit</button>}{onDelete && <button onClick={() => { if (window.confirm(`Delete “${event.name}”?`)) onDelete(); }} className="rounded-xl border border-rose-500/30 px-3 py-2.5 text-xs font-semibold text-rose-400 hover:bg-rose-500/10">Delete</button>}</div></div></article>;
}

function SectionIntro({ title, subtitle, theme }: { title: string; subtitle: string; theme: { muted: string } }) { return <div><p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-violet-400">EVENT WORKSPACE</p><h2 className="text-3xl font-bold tracking-tight">{title}</h2><p className={`mt-3 max-w-3xl text-sm leading-6 ${theme.muted}`}>{subtitle}</p></div>; }
function EventPicker({ events, selectedId, onChange, theme }: { events: EventItem[]; selectedId: string; onChange: (value: string) => void; theme: { input: string } }) { return <div className="max-w-xl"><label htmlFor="event-picker" className="mb-2 block text-sm font-semibold">Select event</label><select id="event-picker" value={selectedId} onChange={(e) => onChange(e.target.value)} className={`w-full rounded-xl border ${theme.input} p-3 outline-none focus:border-violet-500`}>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></div>; }
function MiniInfo({ label, value, theme }: { label: string; value: string | number; theme: { soft: string; muted: string } }) { return <div className={`rounded-xl ${theme.soft} p-4`}><p className={`text-xs ${theme.muted}`}>{label}</p><p className="mt-1 break-words font-bold">{value}</p></div>; }
function BudgetTable({ breakdown, total, theme }: { breakdown: { category: string; amount: number; percent: number }[]; total: number; theme: { line: string; muted: string; soft: string } }) { return <div className="mt-5 overflow-hidden rounded-xl border border-slate-700/30"><div className={`grid grid-cols-[1fr_auto] gap-3 ${theme.soft} px-4 py-3 text-xs font-bold uppercase tracking-wide ${theme.muted}`}><span>Category</span><span>Estimate</span></div>{breakdown.map((item) => <div key={item.category} className={`grid grid-cols-[1fr_auto] items-center gap-3 border-t ${theme.line} px-4 py-4`}><div className="min-w-0"><p className="break-words text-sm font-semibold">{item.category}</p><div className="mt-2 h-1.5 max-w-xs overflow-hidden rounded-full bg-slate-700/30"><div className="h-full rounded-full bg-violet-500" style={{width:`${Math.min(100, Math.max(0,item.percent))}%`}}/></div></div><div className="text-right"><p className="font-semibold">{currency(item.amount)}</p><p className={`mt-1 text-xs ${theme.muted}`}>{item.percent}%</p></div></div>)}<div className={`flex items-center justify-between border-t ${theme.line} ${theme.soft} px-4 py-4 font-bold`}><span>Total budget</span><span>{currency(total)}</span></div></div>; }
function EmptyState({ theme, text, onClick }: { theme: { panel: string; line: string; muted: string }; text: string; onClick: () => void }) { return <div className={`rounded-2xl border border-dashed ${theme.line} ${theme.panel} p-10 text-center`}><div className="text-3xl text-violet-400">✦</div><p className={`mx-auto mt-3 max-w-md text-sm ${theme.muted}`}>{text}</p><button onClick={onClick} className="mt-5 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white">＋ Create event</button></div>; }
