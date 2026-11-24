"use client";

import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useState } from "react";

interface FormData {
  email: string;
  password: string;
  rememberMe: boolean;
}

interface AuthFormProps {
  formData: FormData;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  isDisabled: boolean;
  isLoading: boolean;
  /** Company brand color for the submit button (company sign-in pages). */
  accentColor?: string | null;
  /** Handle "Forgot password?" in place instead of linking to /reset-password. */
  onForgotPassword?: () => void;
}

export default function AuthForm({
  formData,
  onChange,
  onSubmit,
  isDisabled,
  isLoading,
  accentColor,
  onForgotPassword,
}: AuthFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState("");

  return (
    // POST: a submit before hydration must never put the password in the URL.
    <form method="post" onSubmit={onSubmit} className="space-y-5">

      {/* Email */}
      <div className="relative">
        <input
          type="email"
          name="email"
          value={formData.email}
          onChange={onChange}
          onFocus={() => setFocusedField("email")}
          onBlur={() => setFocusedField("")}
          placeholder="Email*"
          required
          disabled={isDisabled}
          className={`w-full px-4 py-3 bg-[#F2F2F2] border rounded-lg placeholder:text-gray-500 text-gray-700 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent ${
            focusedField === "email"
              ? "ring-2 ring-yellow-400"
              : "border-transparent"
          } ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-red-500">*</span>
      </div>

      {/* Password */}
      <div className="relative">
        <input
          type={showPassword ? "text" : "password"}
          name="password"
          value={formData.password}
          onChange={onChange}
          onFocus={() => setFocusedField("password")}
          onBlur={() => setFocusedField("")}
          placeholder="Password*"
          required
          disabled={isDisabled}
          className={`w-full px-4 py-3 pr-12 bg-[#F2F2F2] border rounded-lg placeholder:text-gray-500 text-gray-700 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent ${
            focusedField === "password"
              ? "ring-2 ring-yellow-400"
              : "border-transparent"
          } ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
        />
        <span className="absolute right-10 top-1/2 -translate-y-1/2 text-red-500">*</span>
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          disabled={isDisabled}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
        </button>
      </div>

      {/* Remember Me & Forgot Password */}
      <div className="flex items-center justify-between">
        <label
          className={`flex items-center group cursor-pointer ${
            isDisabled ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          <input
            type="checkbox"
            name="rememberMe"
            checked={formData.rememberMe}
            onChange={onChange}
            disabled={isDisabled}
            className="w-4 h-4 text-yellow-400 border-gray-300 rounded focus:ring-yellow-400"
          />
          <span className="ml-2 text-sm text-gray-600">Remember me</span>
        </label>
        {onForgotPassword ? (
          <button
            type="button"
            onClick={onForgotPassword}
            disabled={isDisabled}
            className="text-sm text-gray-700 hover:underline disabled:opacity-50"
          >
            Forgot password?
          </button>
        ) : (
          <a
            href="/reset-password"
            className={`text-sm text-gray-700 hover:text-yellow-600 hover:underline ${
              isDisabled ? "opacity-50 pointer-events-none" : ""
            }`}
          >
            Forgot password?
          </a>
        )}
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={isDisabled}
        style={accentColor ? { backgroundColor: accentColor } : undefined}
        className={
          accentColor
            ? `w-full rounded-full px-4 py-3.5 font-semibold !text-white transition-all duration-150 flex items-center justify-center shadow-md ${
                isDisabled ? "opacity-70 cursor-not-allowed" : "hover:brightness-95 active:translate-y-[1px]"
              }`
            : `w-full rounded-full !bg-[#D4AF37] px-4 py-3.5 font-semibold !text-white transition-all duration-150 flex items-center justify-center shadow-[0_5px_0_0_#9a7b18,0_8px_18px_rgba(154,123,24,0.35)] ${
                isDisabled
                  ? "opacity-70 cursor-not-allowed"
                  : "hover:!bg-[#C5A028] hover:shadow-[0_5px_0_0_#8a6b14,0_10px_22px_rgba(154,123,24,0.4)] active:translate-y-[3px] active:shadow-[0_2px_0_0_#9a7b18,0_4px_10px_rgba(154,123,24,0.3)]"
              }`
        }
      >
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          "Sign In"
        )}
      </button>
    </form>
  );
}
