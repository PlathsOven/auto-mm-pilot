import type { ComponentType, ReactNode } from "react";

type ProviderComponent = ComponentType<{ children: ReactNode }>;

/**
 * Compose a list of providers into a single component.
 *
 * Order is outer-to-inner: `composeProviders([A, B, C])` renders as
 * `<A><B><C>{children}</C></B></A>`. This replaces deeply-nested JSX in
 * main.tsx with a flat array that makes the provider stack legible.
 */
export function composeProviders(providers: ProviderComponent[]): ProviderComponent {
  return function ComposedProvider({ children }: { children: ReactNode }) {
    return providers.reduceRight<ReactNode>(
      (acc, Provider) => <Provider>{acc}</Provider>,
      children,
    );
  };
}
