import React, { useState, useEffect } from "react";

export default function OtpAuth() {
  const [mobile, setMobile] = useState("919876543210");
  const [enteredOtp, setEnteredOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [timer, setTimer] = useState(0);
  const [loading, setLoading] = useState(false);

  // Countdown timer for resend
  useEffect(() => {
    let interval = null;
    if (timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [timer]);

  // Handler for Sending OTP (Exact fetch logic requested)
  const handleSendOtp = async (e) => {
    if (e) e.preventDefault();
    if (!mobile.trim()) {
      alert("Please enter a valid mobile number.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mobile: mobile.trim(),
        }),
      });

      const result = await response.json();
      alert(result.message);

      if (response.ok && result.success) {
        setOtpSent(true);
        setTimer(result.resendAvailableInSeconds || 60);
      }
    } catch (error) {
      alert("Network error: Could not connect to server.");
    } finally {
      setLoading(false);
    }
  };

  // Handler for Verifying OTP (Exact fetch logic requested)
  const handleVerifyOtp = async (e) => {
    if (e) e.preventDefault();
    if (!enteredOtp.trim()) {
      alert("Please enter the OTP received.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mobile: mobile.trim(),
          otp: enteredOtp.trim(),
        }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        alert("OTP verified successfully!");
        // Optional: redirect or set authenticated user state here
      } else {
        alert(result.message || "OTP verification failed.");
      }
    } catch (error) {
      alert("Network error: Could not verify OTP.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>Mobile Verification</h2>
        <p style={styles.subtitle}>Enter your mobile number to receive an OTP</p>

        {/* Step 1: Mobile Number Input */}
        <div style={styles.formGroup}>
          <label style={styles.label}>Mobile Number</label>
          <input
            type="tel"
            placeholder="e.g. 919876543210"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            disabled={otpSent || loading}
            style={styles.input}
          />
        </div>

        {!otpSent ? (
          <button
            onClick={handleSendOtp}
            disabled={loading || !mobile}
            style={{
              ...styles.button,
              opacity: loading || !mobile ? 0.6 : 1,
            }}
          >
            {loading ? "Sending OTP..." : "Send OTP"}
          </button>
        ) : (
          /* Step 2: OTP Verification */
          <div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Enter 6-Digit OTP</label>
              <input
                type="text"
                maxLength={6}
                placeholder="Enter 6-digit code"
                value={enteredOtp}
                onChange={(e) => setEnteredOtp(e.target.value)}
                disabled={loading}
                style={{ ...styles.input, textAlign: "center", letterSpacing: "4px", fontSize: "1.2rem" }}
              />
            </div>

            <button
              onClick={handleVerifyOtp}
              disabled={loading || enteredOtp.length < 4}
              style={{
                ...styles.button,
                opacity: loading || enteredOtp.length < 4 ? 0.6 : 1,
              }}
            >
              {loading ? "Verifying..." : "Verify OTP"}
            </button>

            <div style={styles.resendContainer}>
              {timer > 0 ? (
                <span style={styles.timerText}>Resend OTP in {timer}s</span>
              ) : (
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={loading}
                  style={styles.linkButton}
                >
                  Resend OTP
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setOtpSent(false);
                  setEnteredOtp("");
                }}
                style={styles.changeNumberButton}
              >
                Change Mobile Number
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "100vh",
    backgroundColor: "#0d0f12",
    fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    padding: "16px",
  },
  card: {
    backgroundColor: "#171a21",
    borderRadius: "12px",
    padding: "32px",
    maxWidth: "420px",
    width: "100%",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
    border: "1px solid #2a2e39",
    color: "#f0f2f5",
  },
  title: {
    margin: "0 0 8px 0",
    fontSize: "1.5rem",
    color: "#d4af37", // Gold accent matching Hotel Little Jappan theme
    textAlign: "center",
  },
  subtitle: {
    margin: "0 0 24px 0",
    fontSize: "0.9rem",
    color: "#8e95a5",
    textAlign: "center",
  },
  formGroup: {
    marginBottom: "20px",
  },
  label: {
    display: "block",
    marginBottom: "8px",
    fontSize: "0.85rem",
    color: "#b0b7c3",
  },
  input: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: "8px",
    border: "1px solid #333846",
    backgroundColor: "#0f1117",
    color: "#ffffff",
    fontSize: "1rem",
    boxSizing: "border-box",
    outline: "none",
  },
  button: {
    width: "100%",
    padding: "13px",
    borderRadius: "8px",
    border: "none",
    backgroundColor: "#d4af37",
    color: "#000000",
    fontWeight: "bold",
    fontSize: "1rem",
    cursor: "pointer",
    transition: "background-color 0.2s",
  },
  resendContainer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "16px",
    fontSize: "0.85rem",
  },
  timerText: {
    color: "#8e95a5",
  },
  linkButton: {
    background: "none",
    border: "none",
    color: "#d4af37",
    cursor: "pointer",
    textDecoration: "underline",
    padding: 0,
    fontSize: "0.85rem",
  },
  changeNumberButton: {
    background: "none",
    border: "none",
    color: "#8e95a5",
    cursor: "pointer",
    padding: 0,
    fontSize: "0.85rem",
  },
};

