---
description:
globs:
alwaysApply: false
---
# Incremental Development Approach

- **Start Small, Verify Often**
  - Begin with minimal changes to address the core issue
  - Test each change before proceeding to the next modification
  - Build complexity incrementally only when simpler approaches fail

- **Targeted Fixes Over Rewrites**
  - Focus on fixing the specific issue rather than rewriting large sections of code
  - Make surgical changes to problematic areas instead of refactoring entire systems
  - Preserve existing behavior for unrelated functionality

- **Debugging Best Practices**
  - Add strategic logging to understand the flow of execution
  - Trace the problem to its root cause before implementing a fix
  - Verify assumptions with console logs before making changes

- **Examples of Effective Incremental Development:**
  ```javascript
  // ✅ DO: Make targeted changes to fix specific issues
  function createEditableMeasureText(strokeLabel, isSelected) {
    // Add a focused check without changing existing logic
    const isNewlyCreated = window.newlyCreatedStroke && 
                          window.newlyCreatedStroke.label === strokeLabel;
    
    if (isSelected || isNewlyCreated) {
      // Apply focus behavior
    }
  }
  
  // ❌ DON'T: Rewrite the entire function
  function createEditableMeasureText(strokeLabel) {
    // Complete rewrite that might introduce new bugs
  }
  ```

- **Implementation Strategy**
  - Identify the minimal set of changes needed to fix the issue
  - Make changes in isolation to better understand their impact
  - Maintain existing patterns and conventions when possible
  - Add new functionality only after the core issue is resolved

- **When to Consider Larger Refactors**
  - After the immediate issue has been fixed with minimal changes
  - When multiple similar issues point to a fundamental design problem
  - When the incremental approach would lead to excessive complexity
  - As a separate, planned task rather than during bug fixing

- **Documentation and Communication**
  - Document the specific changes made and why they were necessary
  - Explain the rationale for choosing an incremental approach
  - Highlight any areas that might benefit from future refactoring
