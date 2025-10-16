/**
 * Send Screen - Send NOCK transactions
 */

import { useState } from "react";
import { useStore } from "../../store";
import { ScreenContainer } from "../../components/ScreenContainer";
import { Alert } from "../../components/Alert";
import { ChevronLeftIcon } from "../../components/icons/ChevronLeftIcon";
import { ChevronUpIcon } from "../../components/icons/ChevronUpIcon";
import { ChevronDownIcon } from "../../components/icons/ChevronDownIcon";
import { isNockAddress } from "../../../shared/validators";
import { send } from "../../utils/messaging";
import { PROVIDER_METHODS } from "../../../shared/constants";
import { useNumericInput } from "../../hooks/useNumericInput";

export function SendScreen() {
  const { navigate, wallet } = useStore();
  const [toAddress, setToAddress] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const balance = wallet.balance || 0;

  // Numeric inputs with validation and increment/decrement
  const amount = useNumericInput({ min: 0, max: balance });
  const fee = useNumericInput({ min: 0 });

  function handleMaxAmount() {
    amount.setValue(balance.toString());
  }

  async function handleSend() {
    setError("");

    // Validation
    if (!toAddress) {
      setError("Please enter a recipient address");
      return;
    }

    if (!isNockAddress(toAddress)) {
      setError("Invalid Nockchain address");
      return;
    }

    if (amount.numericValue <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    if (amount.numericValue > balance) {
      setError("Insufficient balance");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await send<{ txid?: string; error?: string }>(
        PROVIDER_METHODS.SEND_TRANSACTION,
        [
          {
            to: toAddress,
            amount: amount.numericValue,
            fee: fee.numericValue,
          },
        ]
      );

      if (result?.error) {
        setError(`Error: ${result.error}`);
      } else {
        // Success
        // TODO: Show success message with transaction ID
        navigate("home");
      }
    } catch (err) {
      setError("Failed to send transaction");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScreenContainer className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate("home")}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <ChevronLeftIcon />
        </button>
        <h2 className="text-xl font-semibold">Send NOCK</h2>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar space-y-4">
        {/* To Address */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">To</label>
          <input
            type="text"
            placeholder="Enter Nockchain address"
            className="input-field"
            value={toAddress}
            onChange={(e) => {
              setToAddress(e.target.value);
              setError("");
            }}
          />
        </div>

        {/* Amount */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-gray-400">Amount</label>
            <button
              onClick={handleMaxAmount}
              className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
            >
              Max
            </button>
          </div>
          <div className="relative">
            <input
              type="text"
              placeholder="0.00"
              className="input-field pr-16"
              value={amount.value}
              onChange={(e) => amount.handleChange(e.target.value)}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col gap-0.5">
              <button
                onClick={amount.increment}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <ChevronUpIcon className="w-4 h-4" />
              </button>
              <button
                onClick={amount.decrement}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <ChevronDownIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Balance: {balance.toFixed(2)} NOCK
          </p>
        </div>

        {/* Fee (Optional) */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">
            Fee (optional)
          </label>
          <div className="relative">
            <input
              type="text"
              placeholder="0"
              className="input-field pr-16"
              value={fee.value}
              onChange={(e) => fee.handleChange(e.target.value)}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col gap-0.5">
              <button
                onClick={fee.increment}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <ChevronUpIcon className="w-4 h-4" />
              </button>
              <button
                onClick={fee.decrement}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <ChevronDownIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Optional: Add fee to prioritize your transaction
          </p>
        </div>

        {/* Error Alert */}
        {error && <Alert type="error">{error}</Alert>}
      </div>

      {/* Action Buttons */}
      <div className="space-y-2 pt-4">
        <button
          onClick={handleSend}
          disabled={isSubmitting}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Sending..." : "Send"}
        </button>
        <button
          onClick={() => navigate("home")}
          disabled={isSubmitting}
          className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
      </div>
    </ScreenContainer>
  );
}
