# Lazuli Catalogue — Discovery Notes

## Vision

Lazuli helps independent bookshops keep their catalogue in sync across
their physical store, their website, and major marketplaces without
typing the same data three times.

## Problem

Independent bookshops lose hours per week duplicating SKU updates
between their POS, their Shopify store, and marketplaces such as
Mercado Livre. Mistakes lead to overselling and angry customers.

## Personas

- Owner-operator (e.g. Carla, owns a 200-title shop): cares about
  not overselling, wants 1-click sync.
- Part-time assistant: needs zero-training UI; sees the same screen
  as the owner.

## Goals

- Reduce the time spent on catalogue maintenance from ~6h/week
  to under 1h/week within 3 months.
- Eliminate oversell incidents (target: zero per month).

## Key Features

- One-click pull of stock counts from the POS.
- Push catalogue changes to Shopify and Mercado Livre simultaneously.
- Visual diff before any sync, so the owner can review.

## Business Rules

- Stock cannot go below zero. Any sync that would create negative
  stock must be blocked with a clear message.
- The system must support ISBN-10 and ISBN-13 as the canonical SKU.
- Prices are always stored in BRL; conversions are display-only.

## Acceptance Criteria

- Given a stock change in the POS, when the user clicks "Sync",
  then Shopify and Mercado Livre reflect the new count within 30
  seconds.
- Given a price change in the catalogue, when the user previews,
  then the diff lists each affected marketplace listing.
