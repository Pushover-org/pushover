// AG Grid's Quartz theme, restyled with the Court Ledger tokens so the grid reads as part of the
// ledger, not a pasted-in table (docs/design-direction.md).
import { themeQuartz } from "ag-grid-community";

export const ledgerTheme = themeQuartz.withParams({
  backgroundColor: "#fbfaf5",
  foregroundColor: "#15140f",
  textColor: "#15140f",
  accentColor: "#0d5c46",
  borderColor: "rgba(21, 20, 15, 0.12)",
  chromeBackgroundColor: "#ece8dc",
  headerBackgroundColor: "#ece8dc",
  headerTextColor: "rgba(21, 20, 15, 0.64)",
  headerFontFamily: "var(--font-num)",
  headerFontSize: 11,
  headerFontWeight: 500,
  fontFamily: "var(--font-ui)",
  fontSize: 14,
  rowHeight: 58,
  headerHeight: 40,
  oddRowBackgroundColor: "#f7f5ee",
  rowHoverColor: "rgba(13, 92, 70, 0.06)",
  selectedRowBackgroundColor: "rgba(13, 92, 70, 0.1)",
  wrapperBorderRadius: 14,
  borderRadius: 6,
  spacing: 7,
});
