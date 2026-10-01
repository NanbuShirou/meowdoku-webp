"use strict";

// MeowDoku 2.0 map content. Coordinates are percentages of the visible map.
(function (root) {
  const worldPages = [
    {
      id: "city",
      background: "images/bigmap/0map01.png",
      entries: [
        { size: 6, image: "images/bigmap/A01.png", x: 35, y: 82 },
        { size: 7, image: "images/bigmap/A02.png", x: 65, y: 54 },
        { size: 8, image: "images/bigmap/A03.png", x: 35, y: 24 },
      ],
    },
    {
      id: "sky",
      background: "images/bigmap/0map02.png",
      entries: [
        { size: 9, image: "images/bigmap/B01.png", x: 65, y: 80 },
        { size: 10, image: "images/bigmap/B02.png", x: 35, y: 53 },
        { size: 11, image: "images/bigmap/B03.png", x: 65, y: 25 },
      ],
    },
    {
      id: "space",
      background: "images/bigmap/0map03.png",
      entries: [
        { size: 12, image: "images/bigmap/C01.png", x: 35, y: 65 },
        { type: "random", image: "images/bigmap/C09.png", x: 65, y: 27 },
      ],
    },
  ];

  const locationNames = {
    "6:normal": ["家裡", "街道", "市場", "公園", "巷弄", "學校前", "商店街", "河堤", "車站前", "城市廣場"],
    "6:hard": ["閣樓", "後巷", "夜市", "夜間公園", "地下道", "停車場", "工地", "鐵道旁", "大樓屋頂", "水塔平台"],
    "7:normal": ["車站入口", "咖啡街", "書店巷", "百貨廣場", "電影院", "美食街", "空中連橋", "商辦大樓", "屋頂花園", "城市展望台"],
    "7:hard": ["後門卸貨區", "關門商店街", "地下停車場", "地下街", "倉儲通道", "維修走廊", "機房", "看板平台", "高樓屋頂", "通訊塔"],
    "8:normal": ["公園入口", "植物園", "博物館", "河岸步道", "體育場", "交通中心", "藝文廣場", "高樓區", "屋頂花園", "城市高塔"],
    "8:hard": ["公園後門", "管理區", "地下連通道", "廢棄月台", "維修隧道", "管制車庫", "建築工地", "鷹架平台", "屋頂機械區", "天線平台"],
    "9:normal": ["港口", "漁市場", "海灘", "燈塔岬角", "帆船港", "島嶼碼頭", "珊瑚灣", "海蝕洞", "外海礁區", "遠洋小島"],
    "9:hard": ["港區倉庫", "夜間漁港", "防波堤", "貨運碼頭", "濃霧海面", "暗礁水道", "沉船灣", "廢棄燈塔", "漩渦邊緣", "風暴中心"],
    "10:normal": ["島嶼港口", "海崖步道", "燈塔山", "纜車終點", "浮空小島", "天空橋", "飛行船港", "雲上花園", "彩虹山脊", "上層浮空島"],
    "10:hard": ["暴風港", "暗色海崖", "破損燈塔", "廢棄纜車", "黑雲浮島", "斷裂天空橋", "暴風飛行船", "雷電塔", "颶風眼", "風暴城塞"],
    "11:normal": ["雲之門", "風車丘", "天空列車站", "浮空廣場", "雲上市場", "飛行船總站", "天空花園", "上層都市", "高空觀測台", "天空之冠"],
    "11:hard": ["廢棄雲門", "側風峽谷", "天空列車", "黑暗浮空街", "雷電商業區", "廢棄飛船港", "離子風暴區", "黑雲城塞", "平流層站點", "天候核心"],
    "12:normal": ["月面基地", "月坑平原", "軌道電梯", "太空站", "小行星礦區", "彗星航道", "星雲中繼站", "行星環", "深空觀測站", "星門"],
    "12:hard": ["月面實驗室", "永夜月坑", "軌道殘骸", "無人太空站", "黑色衛星帶", "赤紅星雲", "重力異常區", "暗物質走廊", "未知遺跡", "事件視界門"],
  };

  const themes = {
    "6:normal": "家園街區", "6:hard": "夜行街區",
    "7:normal": "商業中心", "7:hard": "暮色商業區",
    "8:normal": "都會高地", "8:hard": "城市禁區",
    "9:normal": "海岸港區", "9:hard": "夜海港區",
    "10:normal": "海天群島", "10:hard": "風暴群島",
    "11:normal": "天空都市", "11:hard": "高空禁區",
    "12:normal": "星際航路", "12:hard": "深空禁區",
  };

  const smallMaps = {};
  for (let size = 6; size <= 12; size++) {
    const imageNumber = String(size - 5).padStart(2, "0");
    for (const difficulty of ["normal", "hard"]) {
      const key = `${size}:${difficulty}`;
      smallMaps[key] = {
        size,
        difficulty,
        title: `${size}×${size} ${difficulty === "hard" ? "高難" : "一般"} · ${themes[key]}`,
        background: `images/smallmap/1map${imageNumber}${difficulty === "hard" ? "b" : "a"}.png`,
        locations: locationNames[key],
      };
    }
  }

  const spotCoordinates = [
    [25, 88], [69, 80], [31, 71], [72, 62], [34, 53],
    [70, 44], [27, 35], [66, 26], [32, 17], [63, 14],
  ];

  const stageCoordinates = [
    [22, 86], [52, 80], [75, 72], [48, 65], [24, 57],
    [49, 49], [75, 41], [51, 33], [25, 25], [55, 16],
  ];

  const wormholeEntries = [
    [6, 66, 92], [7, 34, 81], [8, 66, 70], [9, 34, 59],
    [10, 66, 48], [11, 34, 37], [12, 66, 26],
  ].map(([size, x, y], index) => ({
    size,
    x,
    y,
    image: `images/smallmap/sBtn08${String.fromCharCode(97 + index)}.png`,
  }));

  root.MeowdokuV2MapData = Object.freeze({
    worldPages,
    smallMaps,
    spotCoordinates,
    stageCoordinates,
    wormholeEntries,
  });
})(globalThis);
