# 입력 신뢰도·반복 기록 6기능 구현 계획

> **실행 방식:** 현재 기능 브랜치에서 `superpowers:executing-plans`와 TDD로 아래 하위 계획을 순서대로 실행한다. 저장소 규칙상 별도 요청 전에는 중간 커밋하지 않는다.

**목표:** 승인된 6개 기능을 기존 바닐라 HTML/CSS/JS·Firebase 구조에 호환되게 추가하고, 마지막에 한 번만 통합 검증·배포 판단을 한다.

**공통 제약:** 기존 entry/preset을 읽을 수 있어야 한다. 영양값을 추측하지 않는다. 사진/OCR 원문/내보내기 파일을 서버에 저장하지 않는다. 기존 미커밋 `public/app.js`, `public/index.html`, `public/sw.js` 변경을 보존한다.

## 실행 순서

1. [영양성분표 OCR](2026-08-19-nutrition-label-ocr.md)
2. [통합 바코드 조회](2026-08-19-unified-barcode-lookup.md)
3. [음식 기록 수정 이력](2026-08-19-entry-revision-history.md)
4. [최근 7일 요약](2026-08-19-weekly-summary.md)
5. [데이터 내보내기·복구](2026-08-19-data-export-restore.md)
6. [한 끼·하루 프리셋](2026-08-19-repeat-meal-presets.md)
7. 통합: `docs/ARCHITECTURE.md`, `docs/NEXT.md`, 서비스워커 digest, 전체 테스트, 모바일 브라우저 확인, 배포 전 diff 소유권 점검.

## 통합 완료 조건

- 각 하위 계획의 RED를 실제로 관찰하고 GREEN을 확인한다.
- `npm test` 0 fail, 변경 JS `node --check`, `git diff --check` 통과.
- Firestore emulator가 가능한 환경이면 본인 데이터 허용/타 사용자 거부를 확인한다. 불가능하면 정확한 사유를 기록한다.
- 로컬 모바일 뷰에서 6개 진입점·취소·오류·빈 상태와 콘솔 오류 0을 확인한다.
- 실제 iPhone 카메라/OCR은 실기기에서 확인하기 전 통과했다고 쓰지 않는다.
