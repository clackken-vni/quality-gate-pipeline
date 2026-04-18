# Quality Gate Pipeline

[![Version](https://img.shields.io/badge/version-1.0.2-blue.svg)](https://github.com/clackken-vni/quality-gate-pipeline)
[![OMC](https://img.shields.io/badge/OMC-%3E%3D4.12.0-green.svg)](https://github.com/clackken-vni/oh-my-claudecode)
[![License](https://img.shields.io/badge/license-MIT-orange.svg)](LICENSE)
[![Category](https://img.shields.io/badge/category-workflow-purple.svg)](#)

---

## 🎯 Plugin chính thức cho Oh-My-ClaudeCode (OMC)

**Evidence-driven 8-stage quality gate pipeline** đảm bảo chất lượng phần mềm thông qua quy trình kiểm soát nghiêm ngặt với bằng chứng xác thực tại mỗi stage.

> Plugin này tích hợp sâu với Claude Code và Oh-My-ClaudeCode, cung cấp MCP-first pipeline với gate verdicts được tính toán bởi runtime, không phải model interpretation.

---

## ✨ Tính năng

| Tính năng | Mô tả |
|-----------|-------|
| **8-Stage Pipeline** | Quy trình từ Requirements → Deployment |
| **MCP-First Gates** | Gate verdicts từ MCP runtime, deterministic |
| **Evidence-Based** | Mỗi stage yêu cầu bằng chứng xác thực |
| **Immutable Requirements** | Requirement hash khóa xuyên suốt pipeline |
| **Retry & Remediation** | Retry thông minh với remediation brief |
| **Session Management** | Resume, edit, checkpoint, rollback |
| **Contract System** | Requirement contracts và test contracts |
| **3 Skills** | `/pipeline`, `/pipe-continue`, `/pipe-edit` |

---

## 📦 Cài đặt

### Qua OMC Marketplace (Khuyên dùng)

```bash
# Trong Claude Code
/omc-setup

# Hoặc trực tiếp
/oh-my-claudecode:omc-setup
```

Chọn `quality-gate-pipeline` từ danh sách plugins có sẵn.

### Cài đặt thủ công

```bash
# Clone về thư mục plugins
git clone https://github.com/clackken-vni/quality-gate-pipeline.git \
  ~/.claude/plugins/quality-gate-pipeline

# Cài đặt dependencies
cd ~/.claude/plugins/quality-gate-pipeline
npm install
```

### Yêu cầu

| Yêu cầu | Phiên bản |
|---------|-----------|
| Node.js | >= 18.0.0 |
| Oh-My-ClaudeCode | >= 4.12.0 |
| Claude Code CLI | Latest |

---

## 🚀 Sử dụng

### Skill: `/pipeline` (hoặc `/quality-gate`)

Khởi tạo và chạy pipeline mới với task description.

```
/pipeline Implement user authentication with JWT tokens

/quality-gate Build REST API for product management
```

**Workflow:**

1. **Stage 0: Interview (Discovery)** - Deep interview để thu thập requirements
2. **Stage 1: Analysis & Tooling** - Phân tích codebase, setup tools
3. **Stage 2: Planning** - Tạo architecture plan, task breakdown
4. **Stage 3: Implementation** - Viết code, type checks
5. **Stage 4: Testing** - Unit tests, integration tests
6. **Stage 5: Review** - Code review, security scan
7. **Stage 6: Integration** - E2E tests, performance benchmarks
8. **Stage 7: Deployment** - Build, deploy, verify

### Skill: `/pipe-continue`

Tiếp tục pipeline đã bị gián đoạn.

```
/pipe-continue abc123def456
```

**Khi sử dụng:**
- Pipeline bị interrupt hoặc pause
- Cần resume từ stage đang dở
- Session đã được save trước đó

### Skill: `/pipe-edit`

Chỉnh sửa pipeline đang chạy.

```
/pipe-edit abc123def456 Change authentication to OAuth2
```

**Khi sử dụng:**
- Cần điều chỉnh requirements mới
- Phát hiện issues cần fix
- Muốn modify implementation approach

---

## 📖 Pipeline Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    QUALITY GATE PIPELINE                     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Stage 0: Interview (Discovery)                          ││
│  │ ├─ Deep interview với oh-my-claudecode:deep-interview   ││
│  │ ├─ Ambiguity threshold validation (< 20%)              ││
│  │ └─ Acceptance criteria testability check               ││
│  └─────────────────────────────────────────────────────────┘│
│                              ▼                               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Stage 1: Analysis & Tooling                              ││
│  │ ├─ Codebase exploration                                 ││
│  │ ├─ Tool verification (test, smoke, lint)                ││
│  │ └─ Test contract creation                               ││
│  └─────────────────────────────────────────────────────────┘│
│                              ▼                               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Stage 2: Planning                                         ││
│  │ ├─ Architecture design                                   ││
│  │ ├─ Task breakdown                                        ││
│  │ └─ Implementation plan                                   ││
│  └─────────────────────────────────────────────────────────┘│
│                              ▼                               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Stage 3: Implementation                                   ││
│  │ ├─ Code implementation                                   ││
│  │ ├─ Type checking                                         ││
│  │ └─ Lint compliance                                        ││
│  └─────────────────────────────────────────────────────────┘│
│                              ▼                               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Stage 4: Testing                                          ││
│  │ ├─ Unit tests                                            ││
│  │ ├─ Integration tests                                     ││
│  │ └─ Coverage validation                                   ││
│  └─────────────────────────────────────────────────────────┘│
│                              ▼                               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Stage 5: Review                                          ││
│  │ ├─ Code review                                           ││
│  │ ├─ Security scan                                         ││
│  │ └─ Quality assessment                                    ││
│  └─────────────────────────────────────────────────────────┘│
│                              ▼                               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Stage 6: Integration                                      ││
│  │ ├─ E2E tests                                             ││
│  │ ├─ Performance benchmarks                                ││
│  │ └─ Integration verification                              ││
│  └─────────────────────────────────────────────────────────┘│
│                              ▼                               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Stage 7: Deployment                                       ││
│  │ ├─ Build verification                                    ││
│  │ ├─ Deployment execution                                  ││
│  │ └─ Post-deploy validation                                ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 🔧 MCP Tools

Plugin cung cấp các MCP tools sau:

### `pipeline_start`

Khởi tạo pipeline session mới.

```typescript
// Input
{
  user_goals: string[],        // Mục tiêu từ interview
  acceptance_criteria: string[], // Tiêu chí chấp nhận
  constraints: string[],       // Ràng buộc
  non_goals: string[]          // Non-goals
}

// Output
{
  session_id: string,
  requirement_hash: string,
  status: "IN_PROGRESS"
}
```

### `pipeline_run_stage`

Submit evidence và evaluate gate.

```typescript
// Input
{
  session_id: string,
  stage: number,           // 0-7
  checks: CheckResult[],
  reviewer_verdict: "PASS" | "FAIL" | "REVISE"
}

// Output
{
  pass: boolean,
  reasons: string[],
  escalated: boolean,
  terminal: boolean
}
```

### `pipeline_status`

Lấy trạng thái session.

```typescript
// Input
{ session_id: string }

// Output
{
  session_id: string,
  current_stage: number,
  attempt: number,
  status: "IN_PROGRESS" | "COMPLETED" | "FAILED" | "UNRESOLVABLE",
  requirement_hash: string
}
```

### `pipeline_resume`

Resume session đã tồn tại.

```typescript
// Input
{ session_id: string }

// Output
{
  session: PipelineSession,
  current_stage: number,
  evidence_summary: object
}
```

### `pipeline_verify`

Verify pipeline integrity.

```typescript
// Input
{ session_id: string }

// Output
{
  valid: boolean,
  requirement_hash_match: boolean,
  evidence_complete: boolean,
  issues: string[]
}
```

### `pipeline_contract`

Create/load requirement và test contracts.

```typescript
// Input
{
  session_id: string,
  action: "create_requirement" | "load_requirement" | "create_test" | "load_test",
  contract?: object
}

// Output
{
  contract_id: string,
  type: "requirement" | "test",
  content: object
}
```

---

## 📁 Cấu trúc Plugin

```
quality-gate-pipeline/
├── server.ts              # MCP server entry point
├── lib/
│   ├── orchestrator.ts    # Session & stage management
│   ├── gate-engine.ts     # Gate evaluation engine
│   ├── evidence.ts        # Evidence handling & hashing
│   ├── contracts.ts       # Requirement/test contracts
│   ├── retry.ts           # Retry logic & remediation
│   └── tooling.ts         # Utility functions
├── skills/
│   ├── pipeline/SKILL.md       # Main pipeline skill
│   ├── pipe-continue/SKILL.md   # Resume skill
│   └── pipe-edit/SKILL.md       # Edit skill
├── tests/
│   ├── e2e/               # End-to-end tests
│   └── unit/               # Unit tests
├── scripts/
│   ├── verify.sh          # Verification script
│   └── e2e-all-phases.sh  # E2E runner
├── .claude-plugin/
│   ├── marketplace.json   # Marketplace metadata
│   └── plugin.json        # Plugin config
├── .mcp.json              # MCP server config
├── plugin.json            # OMC plugin manifest
└── package.json           # NPM package config
```

---

## 🔑 Key Concepts

### Evidence-Based Gates

Mỗi stage yêu cầu bằng chứng cụ thể:

```typescript
{
  criterion: "ambiguity_threshold",
  result: "PASS",
  evidence: "Ambiguity score: 12% (below 20% threshold)",
  tool_used: "deep-interview"
}
```

### Immutable Requirements

Requirement hash được khóa khi pipeline start:

```
requirement_hash = SHA256(user_goals + acceptance_criteria + constraints + non_goals)
```

Hash này **không thay đổi** xuyên suốt pipeline, đảm bảo integrity.

### Retry with Remediation

Khi stage FAIL, hệ thống cung cấp remediation brief:

```typescript
{
  pass: false,
  reasons: ["Stage 0: ambiguity above threshold"],
  remediation_brief: "Re-run deep-interview with focus on: ...",
  terminal: false
}
```

### State Management

Pipeline state được lưu tại `.omc/quality-gate/`:

```
.omc/quality-gate/{session_id}/
├── session.json          # Session metadata
├── requirement_hash.txt  # Locked hash
├── gate-log.jsonl        # Evaluation log
├── stage-{n}/            # Stage evidence
│   ├── evidence.json
│   └── checkpoint.json
└── unresolvable-report.json  # Terminal failure
```

---

## 🧪 Testing

```bash
# Unit tests
npm test

# Smoke tests
npm run smoke

# E2E tests
npm run e2e

# All tests
npm run e2e:all
```

---

## 🔗 Tích hợp với Skills khác

Pipeline tích hợp với các OMC skills:

| Stage | Skill |
|-------|-------|
| 0 | `oh-my-claudecode:deep-interview` |
| 1 | `oh-my-claudecode:plan` |
| 2 | `oh-my-claudecode:plan` |
| 3 | `oh-my-claudecode:executor` |
| 4 | `oh-my-claudecode:executor` |
| 5 | `oh-my-claudecode:code-reviewer` |
| 6 | `oh-my-claudecode:executor` |
| 7 | `oh-my-claudecode:executor` |

---

## 📋 Requirements

### Stage Criteria

| Stage | Criterion | PASS Condition |
|-------|-----------|----------------|
| 0 | `ambiguity_threshold` | Ambiguity < 20% |
| 0 | `ac_testable` | All AC testable |
| 1 | `tools_installed` | All tools available |
| 1 | `dependencies_verified` | Deps installed |
| 2 | `architecture_plan` | Plan approved |
| 2 | `task_breakdown` | Tasks defined |
| 3 | `code_complete` | Implementation done |
| 3 | `type_checks_pass` | `tsc --noEmit` passes |
| 4 | `unit_tests_pass` | Unit tests green |
| 4 | `integration_tests_pass` | Integration tests green |
| 5 | `code_review_pass` | Review approved |
| 5 | `security_scan_clean` | No vulnerabilities |
| 6 | `e2e_tests_pass` | E2E tests green |
| 6 | `performance_benchmarks` | Benchmarks met |
| 7 | `build_success` | Build completes |
| 7 | `deployment_verified` | Deployment verified |

---

## 🤝 Đóng góp

Contributions are welcome!

1. Fork repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'feat: add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 👤 Author

**hungdang**  
Email: clackken.vni@gmail.com  
GitHub: [@clackken-vni](https://github.com/clackken-vni)

---

## 🙏 Acknowledgments

- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP SDK
- [Oh-My-ClaudeCode](https://github.com/clackken-vni/oh-my-claudecode) - OMC Framework
- [Claude Code](https://claude.ai/code) - AI-powered development

---

**Quality Gate Pipeline** - *Ensuring software quality through evidence-driven verification*