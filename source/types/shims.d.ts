// Offline sandbox has no @types/react. These shims keep `tsc` useful for the
// logic code (core, ai, server) while the React layer is loosely typed.
declare module 'react';
declare module 'react/jsx-runtime';
declare module 'react-dom/client';
declare module 'react-dom/server';
declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
  interface IntrinsicAttributes { key?: any }
  interface ElementChildrenAttribute {
    children: {};
  }
  type Element = any;
}
