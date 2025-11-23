import { AgGridReact } from 'ag-grid-react';
import { useEffect, useRef, useState } from 'react';
import {
  AllCommunityModule,
  Column,
  ColumnGroup,
  ColumnHeaderClickedEvent,
  GridApi,
  ModuleRegistry,
  type ColDef,
} from 'ag-grid-community';
import './App.scss';

ModuleRegistry.registerModules([AllCommunityModule]);

type HeaderInfo = {
  node: Column | ColumnGroup;
  id: string; // colId or groupId
  kind: 'col' | 'group';
  depth: number; // 헤더 row depth (0,1,2,...)
  leafStart: number; // 이 헤더가 커버하는 leaf index 시작
  leafEnd: number; // 이 헤더가 커버하는 leaf index 끝
};

// 🔹 getAllDisplayedColumnGroups() 만 사용, Map 대신 배열로
const buildHeaderModelFromGroups = (columnApi: GridApi): HeaderInfo[] => {
  const roots = columnApi.getAllDisplayedColumnGroups() as (Column | ColumnGroup)[];
  const headers: HeaderInfo[] = [];
  let leafCounter = 0; // leaf index 직접 증가시킴

  const processNode = (node: Column | ColumnGroup, depth: number): { start: number; end: number } | null => {
    const anyNode = node;

    // ✅ leaf column
    if (anyNode.isColumn) {
      const col = node as Column;
      const colId = col.getColId();
      const idx = leafCounter++;

      headers.push({
        node: col,
        id: colId,
        kind: 'col',
        depth,
        leafStart: idx,
        leafEnd: idx,
      });

      return { start: idx, end: idx };
    }

    // ✅ group
    const group = node as any;

    // padding / wrapper group 은 자기 자신은 만들지 않고 children만 처리
    if (group.isPadding && group.isPadding()) {
      const children = group.getChildren?.();
      if (!children) return null;

      let min = Infinity;
      let max = -Infinity;
      let has = false;

      (children as (Column | ColumnGroup)[]).forEach(child => {
        const span = processNode(child, depth); // depth 그대로
        if (span) {
          has = true;
          min = Math.min(min, span.start);
          max = Math.max(max, span.end);
        }
      });

      if (!has) return null;
      return { start: min, end: max };
    }

    // 실제 의미 있는 group
    const children = group.getChildren?.();
    if (!children) return null;

    // 그룹 헤더를 children 보다 먼저 나오게 하려면,
    // 일단 placeholder 를 넣고 나중에 leafStart/leafEnd 채움
    const idxInHeaders = headers.length;
    headers.push({
      node: group,
      id: group.getGroupId(),
      kind: 'group',
      depth,
      leafStart: 0,
      leafEnd: 0,
    });

    let min = Infinity;
    let max = -Infinity;
    let has = false;

    (children as (Column | ColumnGroup)[]).forEach(child => {
      const span = processNode(child, depth + 1);
      if (span) {
        has = true;
        min = Math.min(min, span.start);
        max = Math.max(max, span.end);
      }
    });

    if (!has) {
      // 자식이 없으면 이 group 은 버림
      headers.splice(idxInHeaders, 1);
      return null;
    }

    headers[idxInHeaders].leafStart = min;
    headers[idxInHeaders].leafEnd = max;

    return { start: min, end: max };
  };

  roots.forEach(root => processNode(root, 0));

  return headers;
};

// id 로 HeaderInfo 찾기 (배열에서 첫 번째 것 기준)
const getHeaderInfo = (model: HeaderInfo[], id: string): HeaderInfo | null => {
  return model.find(info => info.id === id) ?? null;
};

const computeSelectionFromGroups = (model: HeaderInfo[], anchorId: string, targetId: string) => {
  const infoA = getHeaderInfo(model, anchorId);
  const infoB = getHeaderInfo(model, targetId);
  if (!infoA || !infoB) return { selectedIds: [] as string[] };

  // 🔹 leaf 기준 선택 구간
  const leafStart = Math.min(infoA.leafStart, infoB.leafStart);
  const leafEnd = Math.max(infoA.leafEnd, infoB.leafEnd);

  const selectedLeafIds: string[] = [];
  const selectedGroupIds: string[] = [];

  // 1) leaf 전부 선택 (배열 순서 = display 순서)
  for (const info of model) {
    if (info.kind !== 'col') continue;
    if (info.leafStart >= leafStart && info.leafEnd <= leafEnd) {
      selectedLeafIds.push(info.id);
    }
  }

  // 2) group 은 anchor / target depth 가 같을 때만 선택 (기존 로직 유지)
  if (infoA.depth === infoB.depth) {
    const baseDepth = infoA.depth;

    for (const info of model) {
      if (info.kind !== 'group') continue;
      if (info.depth < baseDepth) continue;

      if (info.leafStart >= leafStart && info.leafEnd <= leafEnd) {
        selectedGroupIds.push(info.id);
      }
    }
  }

  return { selectedIds: [...selectedLeafIds, ...selectedGroupIds] };
};

function App() {
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const lastClickedIdRef = useRef<string | null>(null);
  const [pressShift, setPressShift] = useState<boolean>(false);

  const onColumnHeaderClicked = (params: ColumnHeaderClickedEvent) => {
    // Column | ProvidedColumnGroup 둘 다 여기로 들어옴
    const colOrGroup = params.column as any;
    const id =
      typeof colOrGroup.getColId === 'function'
        ? colOrGroup.getColId()
        : typeof colOrGroup.getGroupId === 'function'
          ? colOrGroup.getGroupId()
          : null;

    if (!id) return;

    // ✅ getAllDisplayedColumnGroups 기반 최신 뷰 모델
    const model = buildHeaderModelFromGroups((params as any).columnApi ?? (params as any).api);
    // console.log('model:', model);

    setSelectedCols(prev => {
      if (pressShift && lastClickedIdRef.current) {
        const { selectedIds } = computeSelectionFromGroups(model, lastClickedIdRef.current, id);
        lastClickedIdRef.current = id;
        return selectedIds;
      }

      // 그냥 클릭이면 단일 선택
      lastClickedIdRef.current = id;
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
    const group = params.columnGroup as any;
    const col = params.column as any;

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
        columnDefs={[
          {
            // [그룹] A1
            headerName: 'A1',
            colId: 'A1',
            groupId: 'A1',
            marryChildren: true,
            headerClass,
            children: [
              {
                headerName: 'A1-1',
                field: 'a1',
                colId: 'A1_1',
                headerClass,
              },
              {
                headerName: 'A1-2',
                field: 'a2',
                colId: 'A1_2',
                headerClass,
              },
              {
                headerName: 'A1-3',
                field: 'a3',
                colId: 'A1_3',
                groupId: 'A1_3',
                marryChildren: true,
                headerClass,
                children: [
                  {
                    headerName: 'A1-3-1',
                    field: 'a13',
                    colId: 'A1_3_1',
                    headerClass,
                  },
                  {
                    headerName: 'A1-3-2',
                    field: 'a14',
                    colId: 'A1_3_2',
                    headerClass,
                  },
                ],
              },
            ],
          },
          {
            headerName: 'A2',
            field: 'a4',
            colId: 'A2',
            headerClass,
          },
          {
            headerName: 'A3',
            field: 'a5',
            colId: 'A3',
            headerClass,
          },
          {
            headerName: 'A4',
            colId: 'A4',
            groupId: 'A4',
            marryChildren: true,
            headerClass,
            children: [
              {
                headerName: 'A4-1',
                field: 'a7',
                colId: 'A4_1',
                headerClass,
              },
              {
                headerName: 'A4-2',
                field: 'a8',
                colId: 'A4_2',
                headerClass,
              },
              {
                headerName: 'A4-3',
                field: 'a9',
                colId: 'A4_3',
                headerClass,
              },
              {
                headerName: 'A4-4',
                field: 'a10',
                colId: 'A4_4',
                headerClass,
              },
              {
                headerName: 'A4-5',
                field: 'a11',
                colId: 'A4_5',
                headerClass,
              },
              {
                headerName: 'A4-6',
                field: 'a12',
                colId: 'A4_6',
                headerClass,
                pinned: 'left',
              },
            ],
          },
        ]}
        onColumnHeaderClicked={onColumnHeaderClicked}
        loading={false}
      />
    </div>
  );
}

export default App;
