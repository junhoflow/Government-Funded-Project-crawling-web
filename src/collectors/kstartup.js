const { fetchJson } = require('../lib/http')
const { compactObject, decodeHtml, formatDateTime, isOngoingFromDates, mapConcurrent, parseDate } = require('../lib/utils')

const API_URL = 'https://nidview.k-startup.go.kr/view/public/call/kisedKstartupService/announcementInformation'
const PER_PAGE = 100

function buildUrl(page) {
  const url = new URL(API_URL)
  url.searchParams.set('page', String(page))
  url.searchParams.set('perPage', String(PER_PAGE))
  return url.toString()
}

function normalizeItem(item) {
  const applyStart = parseDate(item.pbanc_rcpt_bgng_dt)
  const applyEnd = parseDate(item.pbanc_rcpt_end_dt)
  const summary = decodeHtml(item.pbanc_ctnt)
  const title = decodeHtml(item.biz_pbanc_nm)
  const detailUrl = item.detl_pg_url || ''
  const applicationUrl = item.aply_mthd_onli_rcpt_istc || item.biz_aply_url || item.biz_gdnc_url || detailUrl
  const applicationMethod = [
    item.aply_mthd_vst_rcpt_istc,
    item.aply_mthd_pssr_rcpt_istc,
    item.aply_mthd_fax_rcpt_istc,
    item.aply_mthd_onli_rcpt_istc,
    item.aply_mthd_etc_istc
  ]
    .filter(Boolean)
    .join(' | ')

  const searchText = [
    title,
    summary,
    item.supt_biz_clsfc,
    item.supt_regin,
    item.pbanc_ntrp_nm,
    item.sprv_inst,
    item.aply_trgt,
    item.aply_trgt_ctnt,
    item.prfn_matr
  ]
    .filter(Boolean)
    .join(' ')

  return compactObject({
    id: `kstartup:${item.pbanc_sn}`,
    sourceKey: 'kstartup',
    source: 'K-Startup',
    sourceId: String(item.pbanc_sn),
    title,
    summary,
    content: summary,
    category: item.supt_biz_clsfc,
    region: item.supt_regin,
    managingOrg: item.pbanc_ntrp_nm,
    executingOrg: item.biz_prch_dprt_nm,
    supervisingInstitutionType: item.sprv_inst,
    applicationMethod,
    applicationUrl,
    applicationSite: item.biz_gdnc_url,
    contact: item.prch_cnpl_no,
    applyTarget: item.aply_trgt_ctnt || item.aply_trgt,
    applyAge: item.biz_trgt_age,
    experience: item.biz_enyy,
    preferred: item.prfn_matr,
    applicantExclusion: item.aply_excl_trgt_ctnt,
    applyStart,
    applyEnd,
    applyPeriodText: [applyStart, applyEnd].filter(Boolean).join(' ~ '),
    postedAt: applyStart,
    isOngoing: item.rcrt_prgs_yn === 'Y' || isOngoingFromDates(applyStart, applyEnd),
    detailUrl,
    originUrl: item.biz_gdnc_url || detailUrl,
    attachments: [],
    tags: [],
    collectedAt: formatDateTime(),
    sourceStatus: item.rcrt_prgs_yn,
    searchText
  })
}

async function collectKStartup(onProgress = () => {}) {
  onProgress({ stage: 'kstartup', phase: 'list', current: 0, total: 1, message: 'K-Startup 1페이지 조회 중' })
  const firstPage = await fetchJson(buildUrl(1))
  const totalPages = Math.ceil((firstPage.totalCount || 0) / PER_PAGE)
  const pages = Array.from({ length: Math.max(totalPages - 1, 0) }, (_, index) => index + 2)

  onProgress({
    stage: 'kstartup',
    phase: 'list',
    current: 1,
    total: totalPages,
    message: `K-Startup 총 ${totalPages}페이지 수집`,
    totalPages
  })

  const pageResults = await mapConcurrent(pages, 10, async (page, index) => {
    const json = await fetchJson(buildUrl(page))
    onProgress({
      stage: 'kstartup',
      phase: 'list',
      current: index + 2,
      total: totalPages,
      message: `K-Startup ${index + 2}/${totalPages}페이지 완료`,
      currentPage: page,
      totalPages
    })
    return json.data || []
  })

  const items = [firstPage.data || [], ...pageResults].flat().map(normalizeItem)

  onProgress({
    stage: 'kstartup',
    phase: 'done',
    current: totalPages,
    total: totalPages,
    message: `K-Startup ${items.length}건 정규화 완료`
  })

  return items
}

module.exports = {
  collectKStartup
}
