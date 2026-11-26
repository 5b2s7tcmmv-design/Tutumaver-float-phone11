"use client";

import { useState } from "react";
import { WalletPanel } from "@/components/chat/wallet-panel";
import { refreshWalletLiving } from "@/lib/wallet-life-generation";
import type { Character } from "@/lib/character-types";

export function CheckPhoneAssetsPage({ character, onBack }: { character: Character; onBack: () => void }) {
  const [loading, setLoading] = useState(false);
  const setError = (message:string)=>{if(message)window.dispatchEvent(new CustomEvent("global-notice",{detail:message}));};
  async function refresh() {
    if (loading) return;
    setLoading(true); setError("");
    try {
      const result = await refreshWalletLiving(character.id);
      if (result.skipped) setError(`${result.skipped} 条消费超过储蓄卡余额，未记入流水。请到自己的资产设置检查角色配置。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "刷新失败"); }
    finally { setLoading(false); }
  }
  return <div style={{ height: "100%", position: "relative" }}><WalletPanel ownerId={character.id} ownerName={character.name} readOnly onBack={onBack} onRefresh={refresh} refreshLoading={loading}/></div>;
}
