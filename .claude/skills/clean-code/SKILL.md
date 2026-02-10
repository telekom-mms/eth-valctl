# Clean Code Skill

This skill enforces clean code principles and code quality guidelines when implementing, refactoring, or writing code.

## When to Use This Skill

Use this skill when:
- Implementing new features or functionality
- Refactoring existing code
- Writing or modifying any source code
- Reviewing code for quality improvements

## Mandatory Standards

All code generation must adhere to these principles and practices.

---

## Clean Code Principles (by Level)

### Red Level - Foundation

**Principles:**
- **DRY (Don't Repeat Yourself):** Extract duplicate code into reusable methods/classes
- **KISS (Keep it Simple, Stupid):** Choose simplest solution; avoid unnecessary complexity
- **Beware of Premature Optimization:** Clarity and correctness first; optimize when proven necessary
- **Favour Composition over Inheritance:** Use composition for flexible, testable systems
- **IOSP (Integration Operation Segregation):** Separate logic-only methods from coordination-only methods

**Practices:**
- **Boy Scout Rule:** Leave code cleaner than found
- **Root Cause Analysis:** Address underlying causes, not symptoms
- **Simple Refactorings:** Apply Extract Method and Rename

### Orange Level - Structure

**Principles:**
- **Single Level of Abstraction:** Keep operations at same abstraction level
- **SRP (Single Responsibility):** Every class has one reason to change
- **SoC (Separation of Concerns):** Isolate responsibilities into separate modules
- **Source Code Conventions:** Consistent naming and standards

**Practices:**
- **Automated Integration Tests:** Verify behavior across components
- **Reviews:** Peer review all changes

### Yellow Level - Interfaces

**Principles:**
- **ISP (Interface Segregation):** Focused interfaces; no unused method dependencies
- **DIP (Dependency Inversion):** Depend on abstractions, not concrete implementations
- **LSP (Liskov Substitution):** Subtypes replaceable for base types
- **Principle of Least Astonishment:** Design matches expectations
- **Information Hiding:** Hide implementation; expose only necessary interfaces

**Practices:**
- **Automated Unit Tests:** Comprehensive isolated testing (>80% coverage)
- **Mockups:** Test doubles to isolate units

### Green Level - Extension

**Principles:**
- **OCP (Open Closed):** Open for extension, closed for modification
- **Tell, Don't Ask:** Command objects instead of querying state
- **Law of Demeter:** Only interact with immediate collaborators

**Practices:**
- **CI (Continuous Integration):** Build and test on every commit
- **Static Code Analysis:** Detect quality issues automatically
- **IoC Container:** Dependency injection for loose coupling

### Blue Level - Architecture

**Principles:**
- **Design and Implementation Don't Overlap:** Clear separation
- **Implementation Reflects Design:** Code mirrors architecture
- **YAGNI:** Implement only required features; no speculative development

**Practices:**
- **Test First:** Write tests before implementation
- **Component Orientation:** Loosely coupled, independently deployable
- **Iterative/Incremental Development:** Short cycles, progressive delivery

---

## Code Quality Guidelines

### Workflow Rules

- **Verify Information:** No assumptions without evidence
- **File-by-File Changes:** One file at a time for review
- **Preserve Existing Code:** Don't remove unrelated code
- **Single Chunk Edits:** All edits in one chunk per file

### Communication Rules

- **No Apologies:** Fix issues directly
- **No Understanding Feedback:** No "I understand" comments
- **No Summaries:** Don't summarize changes
- **No Inventions:** Only requested changes
- **No Unnecessary Confirmations:** Don't re-confirm provided info
- **No Implementation Checks:** Don't ask to verify visible code

### Code Rules

- **No Code Comments:** Unless explicitly requested
- **Mandatory Documentation:** JSDoc, docstrings, type docs required
- **No Whitespace Suggestions:** Focus on logic changes
- **No Unnecessary Updates:** Don't change files without modifications

---

## Quick Reference

| Principle | Description |
|-----------|-------------|
| DRY | No duplicate code |
| KISS | Simplest solution |
| SRP | One reason to change |
| OCP | Open extension, closed modification |
| LSP | Subtypes replace base types |
| ISP | Focused interfaces |
| DIP | Depend on abstractions |
| YAGNI | Only what's needed |
| LoD | Talk to friends only |
