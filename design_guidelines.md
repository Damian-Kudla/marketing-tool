# Design Guidelines: Mobile Sales Acquisition Tool

## Design Approach
**Utility-First Mobile Application** - Inspired by professional mobile scanning apps (CamScanner, Adobe Scan) optimized for one-handed operation and quick data capture in field conditions.

## Color System

### Core Palette
- **Primary**: `207 100% 40%` (Professional Blue #0066CC) - Main actions, headers
- **Success**: `134 61% 41%` (Green #28A745) - Positive indicators, existing customers
- **Warning**: `45 100% 51%` (Yellow #FFC107) - Attention states, prospects
- **Background**: `210 17% 98%` (Light Grey #F8F9FA) - App background
- **Text Primary**: `210 11% 15%` (Dark Grey #212529) - Main content
- **Border**: `210 14% 89%` (Light Border #DEE2E6) - Dividers, card borders

### Dark Mode (Optional Enhancement)
- Background: `210 11% 15%`
- Cards: `210 10% 20%`
- Text: `210 17% 98%`

## Typography
- **Primary Font**: SF Pro Display (iOS) / Inter (fallback)
- **Display**: 24px bold for screen titles
- **Body**: 16px regular for content, 14px for labels
- **Small**: 12px for metadata and captions
- **Line Height**: 1.5 for readability on mobile

## Layout System

### Spacing Scale
Use Tailwind units: **2, 4, 8, 16** (corresponding to p-2, p-4, p-8, p-16)
- Standard padding: `p-4` (16px) throughout app
- Card spacing: `space-y-4` between elements
- Section gaps: `gap-8` for major sections
- Touch target minimum: 44px (h-11 or larger)

### Mobile-First Grid
- Single-column layout for all content
- Full-width cards with rounded corners (`rounded-lg`)
- Sticky bottom action bar for primary CTAs
- Safe area padding for iOS notch/home indicator

## Component Library

### Camera Interface
- Full-screen camera view with overlay guidelines
- Floating capture button (80px diameter, centered bottom)
- Image preview thumbnail after capture
- Retake/Confirm actions clearly visible

### Address Form
- Large input fields (min 44px height)
- GPS indicator icon with loading state
- Individual fields: Street, Number, City, Postal Code, Country
- Manual edit button always visible
- Auto-fill with smooth animation

### Results Display Cards
- White background cards on grey app background
- 16px padding inside cards
- Clear section headers (14px bold)
- Name list items with customer status badges
- Color-coded status: Green (existing), Yellow (prospect)

### Action Buttons
- Primary button: Blue background, white text, 48px height
- Secondary button: Outline style with blue border
- Icon buttons: 44px touch target minimum
- Sticky footer positioning for main actions

### Language Toggle
- Flag icons or text labels (DE/EN)
- Fixed position (top-right corner)
- Simple toggle interaction

## Navigation & Flow
- Single-screen interface with collapsible sections
- Smooth scroll to sections (GPS → Photo → Results)
- Clear visual hierarchy with section dividers
- Back/Reset actions in top navigation bar

## Interaction Patterns
- Large touch targets optimized for thumbs
- Instant visual feedback on all taps
- Loading states with spinners for API calls
- Success/error toast notifications at top
- Swipe gestures for image gallery (if multiple photos)

## Animations
- Minimal, purposeful animations only:
  - GPS location pulse indicator
  - Loading spinners for API calls
  - Smooth expand/collapse for sections
  - No decorative animations to maintain performance

## Images
**No hero images** - This is a utility app, not a marketing page. Focus on functional UI elements, camera viewfinder, and clear data display.

## Mobile Optimization
- Optimized for iOS Safari and Chrome mobile
- Touch-friendly spacing throughout
- Portrait orientation primary, landscape secondary
- Fast load times for field use
- Offline-capable loading states

## Accessibility
- WCAG AA contrast ratios minimum
- Clear focus states for keyboard navigation
- Icon buttons paired with text labels
- Language-appropriate text direction (LTR)