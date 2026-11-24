"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { useToast } from "@/contexts/toast-context";
import {
  persistAuthReturnTo,
  readPendingAuthReturnTo,
  signInHref,
} from "@/utils/authRedirect";

export default function useSignupHandlers() {
  const router = useRouter();
  const { setEmailForVerification } = useAuthStore();
  const { addToast } = useToast();
  const [pendingReturnTo, setPendingReturnTo] = useState<string | null>(null);

  useEffect(() => {
    const returnTo = readPendingAuthReturnTo();
    persistAuthReturnTo(returnTo);
    setPendingReturnTo(returnTo);
  }, []);

  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    password: "",
    rememberMe: false,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [showUserExistsModal, setShowUserExistsModal] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          fullName: formData.fullName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Signup failed");

      setEmailForVerification(formData.email);
      // Step 0.2/7.1: role toggle removed; clear any legacy key if present.
      localStorage.removeItem("signupRole");

      addToast("Account created! Check your email for a verification code.", "success");
      router.push(
        `/verify-email?email=${encodeURIComponent(formData.email.trim().toLowerCase())}`
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      if (message.toLowerCase().includes("exist")) {
        setShowUserExistsModal(true);
      } else {
        addToast("Signup Failed: " + message, "error");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return {
    formData,
    handleInputChange,
    handleSubmit,
    isLoading,
    addToast,
    showUserExistsModal,
    setShowUserExistsModal,
    signInLink: signInHref(pendingReturnTo ?? "/"),
  };
}
