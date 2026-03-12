const { collectFanfandaero } = require('./fanfandaero')

async function collectSodam(onProgress = () => {}, options = {}) {
  return collectFanfandaero({
    sourceKey: 'sodam',
    sourceName: '소담상회',
    pageUrl: 'https://fanfandaero.kr/portal/v2/sodamIdusPlace.do',
    listUrl: 'https://fanfandaero.kr/portal/v2/selectSprtBizPbancListAll.do',
    listKey: 'sprtBizApplListAll',
    totalKey: 'sprtBizApplListAllTotCnt',
    extraParams: {
      searchOrder: '1',
      searchMode: 'sprtBizNm',
      searchText: '소담상회'
    },
    previousById: options.previousById,
    onProgress
  })
}

module.exports = {
  collectSodam
}
