/**
 * 특허법인 테헤란 청구서 시스템 v2 - Google Apps Script
 *
 * [배포 방법]
 * 1. Google Sheets 열기 → 확장 프로그램 → Apps Script
 * 2. 이 코드 붙여넣기
 * 3. 배포 → 새 배포 → 웹 앱 → 액세스: 모든 사용자 → 배포
 * 4. 생성된 URL을 index.html의 GOOGLE_SHEETS_WEBHOOK에 붙여넣기
 *
 * [시트 구조]
 * - "발행내역" 시트: 발행된 견적서/청구서 목록
 * - "변리사별실적" 시트: 담당 변리사별 집계
 */

// ─────────────────────────────────────────
// 1. 웹훅 수신 (POST)
// ─────────────────────────────────────────
function doPost(e) {
  try {
    const raw = e.postData ? e.postData.contents : '{}';
    const data = JSON.parse(raw);
    const rows = Array.isArray(data.rows) ? data.rows : [data];

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const historySheet  = getOrCreateHistorySheet(ss);
    const attorneySheet = getOrCreateAttorneySheet(ss);

    rows.forEach(function(row) {
      appendToHistory(historySheet, row);
    });

    updateAttorneyStats(historySheet, attorneySheet);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    console.error('doPost error:', err);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ─────────────────────────────────────────
// 2. 시트 초기화 (없으면 생성 + 헤더)
// ─────────────────────────────────────────
function getOrCreateHistorySheet(ss) {
  var sheet = ss.getSheetByName('발행내역');
  if (!sheet) {
    sheet = ss.insertSheet('발행내역');
    var headers = [
      '발행번호', '종류', '수신인', '연락처', '이메일',
      '담당변리사', '견적일', '유효기간', '견적정보', '제목',
      '관납료', '수수료', 'VAT', '합계', '납부상태', '입금확인일', '공유링크'
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#001A35').setFontColor('#FFFFFF').setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 130);   // 발행번호
    sheet.setColumnWidth(10, 300);  // 제목
    sheet.setColumnWidth(17, 260);  // 공유링크
  }
  return sheet;
}

function getOrCreateAttorneySheet(ss) {
  var sheet = ss.getSheetByName('변리사별실적');
  if (!sheet) {
    sheet = ss.insertSheet('변리사별실적');
    var headers = ['담당변리사', '발행건수', '총합계(원)', '최근발행일'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#2563EB').setFontColor('#FFFFFF').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ─────────────────────────────────────────
// 3. 발행번호 자동채번 (EST-2025-001 / INV-2025-001)
// ─────────────────────────────────────────
function generateDocNumber(sheet, docType) {
  var year    = new Date().getFullYear();
  var prefix  = (docType === '청구서') ? 'INV' : 'EST';
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return prefix + '-' + year + '-001';
  }

  var existingNums = sheet.getRange(2, 1, lastRow - 1, 1).getValues()
    .map(function(r) { return r[0]; })
    .filter(function(v) {
      return typeof v === 'string' && v.indexOf(prefix + '-' + year + '-') === 0;
    })
    .map(function(v) {
      var parts = v.split('-');
      return parseInt(parts[2], 10) || 0;
    });

  var next = (existingNums.length > 0 ? Math.max.apply(null, existingNums) : 0) + 1;
  return prefix + '-' + year + '-' + String(next).padStart(3, '0');
}

// ─────────────────────────────────────────
// 4. 발행내역 시트에 행 추가
// ─────────────────────────────────────────
function appendToHistory(sheet, row) {
  var docNum = generateDocNumber(sheet, row.docType || '');
  var agentFee = Number(String(row.agentFee || 0).replace(/,/g, '')) || 0;
  var vat      = row['부가세'] !== undefined ? Number(row['부가세']) : Math.round(agentFee * 0.1);

  sheet.appendRow([
    docNum,
    row.docType    || '',
    row.recipient  || '',
    row.phone      || '',
    row.email      || '',
    row.attorney   || '',
    row.quoteDate  || '',
    row.expiry     || '',
    row.quoteInfo  || '',
    row.title      || '',
    row.govFee     || 0,
    agentFee,
    vat,
    row.total      || 0,
    '미납',          // 납부상태 초기값
    '',              // 입금확인일 (onEdit에서 자동입력)
    row.link       || ''
  ]);

  // 납부상태 열에 드롭다운 유효성 검사 적용
  var lastRow = sheet.getLastRow();
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['미납', '완납'], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(lastRow, 15).setDataValidation(rule);

  // 금액 열 숫자 포맷
  sheet.getRange(lastRow, 11, 1, 4)
    .setNumberFormat('#,##0');
}

// ─────────────────────────────────────────
// 5. 변리사별실적 집계 갱신
// ─────────────────────────────────────────
function updateAttorneyStats(historySheet, attorneySheet) {
  var lastRow = historySheet.getLastRow();
  if (lastRow < 2) return;

  var data = historySheet.getRange(2, 1, lastRow - 1, 17).getValues();
  var stats = {};

  data.forEach(function(row) {
    var attorney = String(row[5] || '').trim();
    var total    = Number(row[13]) || 0;
    var date     = row[6] ? String(row[6]) : '';
    if (!attorney) return;

    if (!stats[attorney]) {
      stats[attorney] = { count: 0, total: 0, lastDate: '' };
    }
    stats[attorney].count++;
    stats[attorney].total += total;
    if (date && date > stats[attorney].lastDate) {
      stats[attorney].lastDate = date;
    }
  });

  // 헤더 유지 후 전체 재작성
  var headerVals = [['담당변리사', '발행건수', '총합계(원)', '최근발행일']];
  attorneySheet.clearContents();
  attorneySheet.getRange(1, 1, 1, 4).setValues(headerVals)
    .setBackground('#2563EB').setFontColor('#FFFFFF').setFontWeight('bold');

  var rows = Object.keys(stats).map(function(name) {
    var s = stats[name];
    return [name, s.count, s.total, s.lastDate];
  });

  if (rows.length > 0) {
    attorneySheet.getRange(2, 1, rows.length, 4).setValues(rows);
    attorneySheet.getRange(2, 3, rows.length, 1).setNumberFormat('#,##0');
  }
}

// ─────────────────────────────────────────
// 6. onEdit 트리거 — 납부상태 변경 시 입금확인일 자동입력
// ─────────────────────────────────────────
function onEdit(e) {
  var sheet = e.source.getActiveSheet();
  if (sheet.getName() !== '발행내역') return;

  var col = e.range.getColumn();
  var row = e.range.getRow();
  if (col !== 15 || row < 2) return;  // 15열 = 납부상태

  var value = e.range.getValue();

  if (value === '완납') {
    // 입금확인일(16열) 자동 입력
    sheet.getRange(row, 16).setValue(new Date())
      .setNumberFormat('yyyy-MM-dd');
    // 행 배경색: 연한 녹색
    sheet.getRange(row, 1, 1, 17).setBackground('#D1FAE5');
  } else if (value === '미납') {
    sheet.getRange(row, 16).setValue('');
    sheet.getRange(row, 1, 1, 17).setBackground(null);
  }

  // 변리사별실적 재집계
  var ss            = e.source;
  var historySheet  = ss.getSheetByName('발행내역');
  var attorneySheet = ss.getSheetByName('변리사별실적');
  if (historySheet && attorneySheet) {
    updateAttorneyStats(historySheet, attorneySheet);
  }
}
