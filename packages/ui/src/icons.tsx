// AIDP icon family. Paper: presentation of the apparatus (steps 1, 12) and the named
// components that sit around the fourteen-step path (register, policy, taxonomy,
// jurisdiction, evaluator). Marks are currentColor so they follow the surface they sit on.
// Source SVGs live beside this file under icons/; keep the two in register.

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

const base = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.1,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
};

export function IconAidp({ title = 'AIRP', ...props }: IconProps) {
  return (
    <svg {...base} {...props}>
      {title ? <title>{title}</title> : null}
      <circle cx="12" cy="12" r="9.8" strokeDasharray="8.096 2.1" strokeLinecap="butt" />
      <path d="M12 6.8 L16.5 9.4 V14.6 L12 17.2 L7.5 14.6 V9.4 Z" fill="currentColor" />
    </svg>
  );
}

export function IconInferenceAdvocate({ title = 'Inference Advocate', ...props }: IconProps) {
  return (
    <svg {...base} {...props}>
      {title ? <title>{title}</title> : null}
      <path d="M3.6 3.4 H20.4 V12.8 C20.4 17.6 16.4 20.9 12 22.4 C7.6 20.9 3.6 17.6 3.6 12.8 Z" />
      <path d="M12 2.9 V19.7" strokeDasharray="4.2 2.1" strokeLinecap="butt" />
    </svg>
  );
}

export function IconDeliveryPolicy({ title = 'Delivery Policy', ...props }: IconProps) {
  return (
    <svg {...base} {...props}>
      {title ? <title>{title}</title> : null}
      <path d="M6 2.6 H14.6 L19.4 7.4 V21.4 H6" />
      <path d="M6 21.4 V2.6" strokeDasharray="4.867 2.1" strokeLinecap="butt" />
      <path d="M9.7 12 H12.2" />
      <path d="M12.2 12 V9 H15.7" />
      <path d="M12.2 12 V15 H15.7" />
    </svg>
  );
}

export function IconJurisdiction({ title = 'Jurisdiction', ...props }: IconProps) {
  return (
    <svg {...base} {...props}>
      {title ? <title>{title}</title> : null}
      <path d="M12 19 C12 19 5.6 13 5.6 8.8 A6.4 6.4 0 0 1 18.4 8.8 C18.4 13 12 19 12 19 Z" />
      <circle cx="12" cy="8.8" r="2.3" />
      <path d="M2 22.6 H22" strokeDasharray="5.267 2.1" strokeLinecap="butt" />
    </svg>
  );
}

export function IconTaxonomy({ title = 'Taxonomy', ...props }: IconProps) {
  return (
    <svg {...base} {...props}>
      {title ? <title>{title}</title> : null}
      <path d="M11.6 4.6 H19.4 V12.4 L10.6 21.2" />
      <path d="M4.6 10.4 L2.2 12.8 L4.6 15.2" />
      <path d="M4.6 15.2 L10.6 21.2" strokeDasharray="3.4425 1.6" strokeLinecap="butt" />
      <path d="M4.6 10.4 L11.6 4.6" strokeDasharray="3.7455 1.6" strokeLinecap="butt" />
    </svg>
  );
}

export function IconServingRegister({ title = 'Serving Register', ...props }: IconProps) {
  return (
    <svg {...base} {...props}>
      {title ? <title>{title}</title> : null}
      <path d="M4.8 4.5 H19.2 A1.8 1.8 0 0 1 21 6.3 V17.7 A1.8 1.8 0 0 1 19.2 19.5 H4.8" />
      <path
        d="M4.8 19.5 A1.8 1.8 0 0 1 3 17.7 V6.3 A1.8 1.8 0 0 1 4.8 4.5"
        strokeDasharray="4.285 2.1"
        strokeLinecap="butt"
      />
      <circle cx="6.8" cy="9.5" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="6.8" cy="14.5" r="1.05" fill="currentColor" stroke="none" />
      <path d="M10.4 9.5 H17.2" />
      <path d="M10.4 14.5 H17.2" />
    </svg>
  );
}

export function IconRuleEvaluator({ title = 'Rule Evaluator', ...props }: IconProps) {
  return (
    <svg {...base} {...props}>
      {title ? <title>{title}</title> : null}
      <path d="M8.6 3.6 H5.4 A1.8 1.8 0 0 0 3.6 5.4" />
      <path d="M3.6 20.2 A1.8 1.8 0 0 0 5.4 22 H18.6 A1.8 1.8 0 0 0 20.4 20.2 V5.4 A1.8 1.8 0 0 0 18.6 3.6 H15.4" />
      <path d="M3.6 5.4 V20.2" strokeDasharray="3.533 2.1" strokeLinecap="butt" />
      <rect x="8.6" y="1.6" width="6.8" height="4" rx="1.2" />
      <path d="M8.2 13.4 L10.9 16.1 L16.2 10.2" />
    </svg>
  );
}
