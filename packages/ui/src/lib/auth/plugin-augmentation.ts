import type { AuthPluginBase } from "@better-auth-ui/core";
import type { ComponentType, ReactNode } from "react";

type AuthViewSlotProps = {
  className?: string;
  socialLayout?: "auto" | "horizontal" | "grid" | "vertical";
  socialPosition?: "top" | "bottom";
};

type PluginAuthButtonProps = { view?: string };

export interface ShadcnAuthPlugin extends AuthPluginBase {
  captchaComponent?: ReactNode;
  authButtons?: ReadonlyArray<ComponentType<PluginAuthButtonProps>>;
  views?: {
    auth?: Record<string, ComponentType<AuthViewSlotProps>>;
    settings?: Record<string, ComponentType<AuthViewSlotProps>>;
  };
  fallbackViews?: {
    auth?: Record<string, ComponentType<AuthViewSlotProps>>;
  };
}

declare module "@better-auth-ui/core" {
  interface AuthPluginRegister {
    shadcnAuthPlugin: ShadcnAuthPlugin;
  }
}
