import { AgGridReact, CustomInnerHeaderGroupProps } from 'ag-grid-react';
import { useEffect, useRef, useState } from 'react';
import {
  AllCommunityModule,
  ColGroupDef,
  Column,
  ColumnGroup,
  ColumnHeaderClickedEvent,
  GridApi,
  ModuleRegistry,
  type ColDef,
} from 'ag-grid-community';
import { FindModule } from 'ag-grid-enterprise';
import './App.scss';
ModuleRegistry.registerModules([AllCommunityModule, FindModule]);

interface HeaderInfo {
  node: Column | ColumnGroup;
  id: string; // colId or groupId
  kind: 'col' | 'group';
  depthStart: number; // 헤더 row depth (0,1,2,...)
  depthEnd: number; // 헤더 row depth (0,1,2,...)
  leafStart: number; // 이 헤더가 커버하는 leaf index 시작
  leafEnd: number; // 이 헤더가 커버하는 leaf index 끝
  uniqueId: string;
}

interface SelectInfo {
  id: string;
  uniqueId: string;
}

interface HeaderModel {
  headers: HeaderInfo[];
  minDepth: number;
  maxDepth: number;
}

const isRowSelection = (a: HeaderInfo, b: HeaderInfo) => {
  // 같은 row(depthStart)에서 시작해야 rowSelection 가능
  return a.depthStart === b.depthStart && a.depthEnd === b.depthEnd;
};

const buildHeaderModelFromGroups = (columnApi: GridApi): HeaderModel => {
  const roots = columnApi.getAllDisplayedColumnGroups() as (Column | ColumnGroup)[];
  const headers: HeaderInfo[] = [];
  let leafCounter = 0;
  let globalMaxDepth = 0;
  let globalMinDepth = Infinity;

  const processNode = (
    node: Column | ColumnGroup,
    depth: number
  ): { start: number; end: number; maxDepth: number } | null => {
    const anyNode = node as any;

    // leaf column
    if (anyNode.isColumn) {
      const col = node as Column;
      const idx = leafCounter++;

      const info: HeaderInfo = {
        node: col,
        id: col.getColId(),
        kind: 'col',
        depthStart: depth,
        depthEnd: depth,
        leafStart: idx,
        leafEnd: idx,
        uniqueId: col.getUniqueId(),
      };

      headers.push(info);
      globalMaxDepth = Math.max(globalMaxDepth, depth);
      globalMinDepth = Math.min(globalMinDepth, depth);
      return { start: idx, end: idx, maxDepth: depth };
    }

    // group
    const group = node as ColumnGroup;

    // padding group → 자기 자신은 만들지 않고 children만 처리
    if (group.isPadding()) {
      const children = group.getChildren?.() as (Column | ColumnGroup)[] | null;
      if (!children) return null;

      let min = Infinity;
      let max = -Infinity;
      let maxDepthInSubtree = depth;
      let has = false;

      children.forEach(child => {
        const span = processNode(child, depth);
        if (span) {
          has = true;
          min = Math.min(min, span.start);
          max = Math.max(max, span.end);
          maxDepthInSubtree = Math.max(maxDepthInSubtree, span.maxDepth);
        }
      });

      if (!has) return null;
      return { start: min, end: max, maxDepth: maxDepthInSubtree };
    }

    // 실제 group
    const children = group.getChildren?.() as (Column | ColumnGroup)[] | null;
    if (!children) return null;

    const idxInHeaders = headers.length;

    const placeholder: HeaderInfo = {
      node: group,
      id: group.getGroupId(),
      kind: 'group',
      depthStart: depth,
      depthEnd: depth, // 나중에 보정
      leafStart: 0,
      leafEnd: 0,
      uniqueId: group.getUniqueId(),
    };

    headers.push(placeholder);

    let min = Infinity;
    let max = -Infinity;
    let maxDepthInSubtree = depth;
    let has = false;

    children.forEach(child => {
      const span = processNode(child, depth + 1);
      if (span) {
        has = true;
        min = Math.min(min, span.start);
        max = Math.max(max, span.end);
        maxDepthInSubtree = Math.max(maxDepthInSubtree, span.maxDepth);
      }
    });

    if (!has) {
      headers.splice(idxInHeaders, 1);
      return null;
    }

    headers[idxInHeaders].leafStart = min;
    headers[idxInHeaders].leafEnd = max;
    headers[idxInHeaders].depthEnd = maxDepthInSubtree;

    globalMaxDepth = Math.max(globalMaxDepth, maxDepthInSubtree);
    globalMinDepth = Math.min(globalMinDepth, depth);

    return { start: min, end: max, maxDepth: maxDepthInSubtree };
  };

  const normalizeDepthEnd = () => {
    // globalMaxDepth 는 processNode 안에서 leaf 기준으로 이미 계산됨
    headers.forEach(h => {
      if (h.kind === 'col') {
        // leaf 컬럼은 자기 depth부터 마지막 행까지 rowSpan
        h.depthEnd = globalMaxDepth;
      } else {
        // group 헤더는 한 행만 사용
        h.depthEnd = h.depthStart;
      }
    });
  };

  roots?.forEach(root => processNode(root, 0));

  // 🔥 여기서 depthEnd 정규화
  normalizeDepthEnd();

  // (선택) 필요하다면 rowSpan 보정 로직을 여기서 추가해도 되고,
  // 지금처럼 논리 depth 그대로 두셔도 됩니다.
  if (!Number.isFinite(globalMinDepth)) globalMinDepth = 0;

  return {
    headers,
    minDepth: globalMinDepth,
    maxDepth: globalMaxDepth,
  };
};

// info 의 "조상"들
const getAncestors = (model: HeaderInfo[], info: HeaderInfo): HeaderInfo[] =>
  model.filter(h => h.depthStart < info.depthStart && h.leafStart <= info.leafStart && h.leafEnd >= info.leafEnd);

// info 아래에 더 깊은 자식이 있는지
const hasDeeperDescendant = (model: HeaderInfo[], info: HeaderInfo) =>
  model.some(h => h.depthStart > info.depthStart && h.leafStart >= info.leafStart && h.leafEnd <= info.leafEnd);

// "full-depth 헤더" : 맨 위 행(minDepth)에 있으면서 자기 아래 더 깊은 자식이 없는 헤더
const isFullDepthHeader = (model: HeaderInfo[], h: HeaderInfo, minDepth: number) =>
  h.depthStart === minDepth && !hasDeeperDescendant(model, h);

const getHeaderInfo = (model: HeaderInfo[], id: string, uniqueId: string): HeaderInfo | null =>
  model.find(info => info.id === id && info.uniqueId === uniqueId) ?? null;

const computeSelectionFromGroups = (
  model: HeaderInfo[],
  minDepth: number,
  maxDepth: number, // 지금은 직접 쓰진 않지만 시그니처 유지
  anchor: SelectInfo,
  target: SelectInfo
): { selectedIds: string[] } => {
  const infoA = getHeaderInfo(model, anchor.id, anchor.uniqueId);
  const infoB = getHeaderInfo(model, target.id, target.uniqueId);
  if (!infoA || !infoB) return { selectedIds: [] };

  const origStart = Math.min(infoA.leafStart, infoB.leafStart);
  const origEnd = Math.max(infoA.leafEnd, infoB.leafEnd);

  const forcedIds = new Set<string>();

  let selStart = origStart;
  let selEnd = origEnd;

  const baseDepth = Math.min(infoA.depthStart, infoB.depthStart);

  const expandByAncestors = (self: HeaderInfo, other: HeaderInfo) => {
    const ancestors = getAncestors(model, self);

    ancestors.forEach(g => {
      // 너무 위(depthStart < baseDepth) 에 있는 조상은 band 확장에 쓰지 않음
      if (g.depthStart < baseDepth) return;

      const otherInside = other.leafStart >= g.leafStart && other.leafEnd <= g.leafEnd;

      // self 만 포함하는 조상이면 그 전체로 확장
      if (!otherInside) {
        selStart = Math.min(selStart, g.leafStart);
        selEnd = Math.max(selEnd, g.leafEnd);
        forcedIds.add(g.id);
      }
    });
  };

  // anchor / target 양쪽에 대해 대칭적으로 처리
  expandByAncestors(infoA, infoB);
  expandByAncestors(infoB, infoA);

  // 2-1️⃣ band 안에 "full-depth 헤더" 가 하나라도 있으면
  //      → 같은 행(minDepth)에 있는 형제 헤더 전체로 band 확장
  // "full-depth 헤더"가 원래 band 안에 완전히 들어온 경우가 있는지
  const existsFullDepthInBand = model.filter(h => h.leafStart > origStart && h.leafEnd < origEnd);

  const bandMinDepth = Math.min(...existsFullDepthInBand.map(h => h.depthStart));

  const existsFullDepthInBand2 = existsFullDepthInBand.filter(h => {
    return isFullDepthHeader(model, h, bandMinDepth);
  });

  if (existsFullDepthInBand2) {
    const sameRowHeaders = model.filter(
      h =>
        h.depthStart === bandMinDepth &&
        // 밴드와 leaf 구간이 한 칸이라도 겹치면 포함
        h.leafEnd >= origStart &&
        h.leafStart <= origEnd
    );

    console.log(' sameRowHeaders:', sameRowHeaders);

    if (sameRowHeaders.length > 0) {
      const minStart = Math.min(...sameRowHeaders.map(r => r.leafStart));
      const maxEnd = Math.max(...sameRowHeaders.map(r => r.leafEnd));

      selStart = Math.min(selStart, minStart);
      selEnd = Math.max(selEnd, maxEnd);

      sameRowHeaders.forEach(r => forcedIds.add(r.id));
    }
  }

  const selectedLeafIds: string[] = [];
  const selectedHeaderIds: string[] = [];

  for (const h of model) {
    // leaf 컬럼
    if (h.kind === 'col') {
      if (h.leafStart >= selStart && h.leafEnd <= selEnd) {
        selectedLeafIds.push(h.id);
        continue;
      }
      continue;
    }

    // 헤더 (group) – baseDepth 보다 위에 있는 애는 자동 선택하지 않음
    if (h.leafStart >= selStart && h.leafEnd <= selEnd && h.depthStart >= baseDepth) {
      selectedHeaderIds.push(h.id);
    }
  }

  forcedIds.forEach(id => selectedHeaderIds.push(id));

  const selectedIds = Array.from(new Set([...selectedLeafIds, ...selectedHeaderIds]));

  return { selectedIds };
};

interface CustomHeaderComponentProps extends CustomInnerHeaderGroupProps {
  onColumnHeaderClicked: (params: CustomHeaderComponentProps) => void;
}

const CustomHeaderComponent = (props: CustomHeaderComponentProps) => {
  const { displayName, eGridHeader, onColumnHeaderClicked: _onColumnHeaderClicked } = props;
  const onColumnHeaderClicked = (event: MouseEvent) => {
    event.stopPropagation();
    _onColumnHeaderClicked(props);
  };
  useEffect(() => {
    eGridHeader.addEventListener('click', onColumnHeaderClicked, { capture: true, passive: true });

    return () => {
      eGridHeader.addEventListener('click', onColumnHeaderClicked, { capture: true, passive: true });
    };
  }, []);

  return <>{displayName}</>;
};

function App() {
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const lastClickedIdRef = useRef<SelectInfo | null>(null);
  const [pressShift, setPressShift] = useState<boolean>(false);
  const [colDefs, setColDefs] = useState<(ColDef<any, any> | ColGroupDef<any>)[]>([
    {
      // [그룹] A1
      headerName: 'A1',
      colId: 'A1',
      marryChildren: true,
      children: [
        {
          headerName: 'A1-1',
          field: 'a1',
          children: [
            {
              headerName: 'A1-1-1',
              field: 'a13',
              // pinned: 'left',
            },
            {
              headerName: 'A1-1-2',
              field: 'a14',
              colId: 'A1_1_2',
            },
          ],
        },
        {
          headerName: 'A1-2',
          field: 'a2',
          colId: 'A1_2',
        },
        {
          headerName: 'A1-3',
          field: 'a3',
          colId: 'A1_3',
          marryChildren: true,
        },
      ],
    },
    {
      headerName: 'A2',
      field: 'a4',
      colId: 'A2',
      groupId: 'A2',
      children: [
        {
          headerName: 'A2-1',
          field: 'a2-1',
          colId: 'A2_1',
          groupId: 'A2_1',
          children: [
            {
              headerName: 'A2-1-1',
              field: 'a2-1-1',
              colId: 'a2_1_1',
            },
            {
              headerName: 'A2-1-2',
              field: 'a2-1-2',
              colId: 'a2_1_2',
            },
          ],
        },
        {
          headerName: 'A2-2',
          field: 'a2-1',
          colId: 'a2_2',
          groupId: 'a2_2',
          children: [
            {
              headerName: 'A2-2-1',
              field: 'a2-2-1',
              colId: 'a2_2_1',
            },
            {
              headerName: 'A2-2-2',
              field: 'a2-2-2',
              colId: 'a2_2_2',
            },
          ],
        },
      ],
    },
    {
      headerName: 'A3',
      field: 'a5',
      colId: 'A3',
    },
    {
      headerName: 'A4',
      colId: 'A4',
      groupId: 'A4',
      marryChildren: true,
      children: [
        {
          headerName: 'A4-1',
          field: 'a7',
          colId: 'A4_1',
        },
        {
          headerName: 'A4-2',
          field: 'a8',
          colId: 'A4_2',
        },
        {
          headerName: 'A4-3',
          field: 'a9',
          colId: 'A4_3',
        },
        {
          headerName: 'A4-4',
          field: 'a10',
          colId: 'A4_4',
        },
        {
          headerName: 'A4-5',
          field: 'a11',
          colId: 'A4_5',
        },
        {
          headerName: 'A4-6',
          field: 'a12',
          colId: 'A4_6',
          // pinned: 'left',
        },
      ],
    },
  ]);

  const onColumnHeaderClicked = (params: ColumnHeaderClickedEvent | CustomHeaderComponentProps) => {
    // Column | ProvidedColumnGroup 둘 다 여기로 들어옴

    let uniqueId: string;
    let id: string;
    if ('eGridHeader' in params) {
      uniqueId = params.columnGroup.getUniqueId();
      id = params.columnGroup.getGroupId();
    } else if (params.column.isColumn) {
      uniqueId = params.column.getUniqueId();
      id = params.column.getColId();
    } else {
      return;
    }

    // ✅ getAllDisplayedColumnGroups 기반 최신 뷰 모델
    const { headers, minDepth, maxDepth } = buildHeaderModelFromGroups(params.api);

    setSelectedCols(prev => {
      if (pressShift && lastClickedIdRef.current) {
        const { selectedIds } = computeSelectionFromGroups(headers, minDepth, maxDepth, lastClickedIdRef.current, {
          id,
          uniqueId,
        });
        lastClickedIdRef.current = { id, uniqueId };
        return selectedIds;
      }

      // 그냥 클릭이면 단일 선택
      lastClickedIdRef.current = { id, uniqueId };
      return [id];
    });
  };

  useEffect(() => {
    const pressShiftHandler = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setPressShift(true);
      }
    };

    const keyupHandler = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setPressShift(false);
      }
    };

    window.addEventListener('keydown', pressShiftHandler);
    window.addEventListener('keyup', keyupHandler);

    return () => {
      window.removeEventListener('keydown', pressShiftHandler);
      window.removeEventListener('keyup', keyupHandler);
    };
  }, []);

  const headerClass: ColDef['headerClass'] = params => {
    const group = params.columnGroup;
    const col = params.column;

    if (group) {
      const gid = typeof group.getGroupId === 'function' ? group.getGroupId() : '';
      return selectedCols.includes(gid) ? 'excel-header-selected' : '';
    }

    if (col) {
      const cid = typeof col.getColId === 'function' ? col.getColId() : '';
      return selectedCols.includes(cid) ? 'excel-header-selected' : '';
    }

    return '';
  };

  return (
    <div style={{ height: 500 }}>
      <AgGridReact
        defaultColDef={{
          headerComponentParams: {},
          sortable: false,
          headerClass,
        }}
        onColumnMoved={e => {
          setColDefs(e.api.getColumnDefs() ?? []);
        }}
        defaultColGroupDef={{
          headerGroupComponentParams: {
            innerHeaderGroupComponent: CustomHeaderComponent,
            innerHeaderGroupComponentParams: {
              onColumnHeaderClicked,
            },
          },
          headerClass,
        }}
        onColumnHeaderClicked={onColumnHeaderClicked}
        columnDefs={colDefs}
        loading={false}
      />
    </div>
  );
}

export default App;
